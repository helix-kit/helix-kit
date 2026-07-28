#include "helix_stream.h"

#include <string.h>

#include "esp_log.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

static const char *TAG = "helix_stream";

// Frame types — byte-compatible with the Go/TS reference.
enum {
    F_OPEN = 0x01,
    F_DATA = 0x02,
    F_END = 0x03,
    F_RESET = 0x04,
    F_SIGNAL = 0x05,
    F_CREDIT = 0x06,
    F_PING = 0x10,
    F_PONG = 0x11,
};

#define FRAME_HEADER 5
#define INITIAL_WINDOW (256 * 1024)
#define CREDIT_THRESHOLD (INITIAL_WINDOW / 2)
#define MAX_CHUNK (8 * 1024)
#define MAX_STREAMS 4
#define SEND_TIMEOUT_MS 5000

struct helix_stream {
    helix_stream_session_t *session;
    uint32_t id;
    bool active;
    int window;   // bytes we may still send (peer-granted)
    int unacked;  // received bytes since we last granted CREDIT
    void *user;
    SemaphoreHandle_t window_sem;  // given when CREDIT arrives
};

struct helix_stream_session {
    esp_websocket_client_handle_t ws;
    helix_stream_callbacks_t cb;
    SemaphoreHandle_t lock;      // guards streams[] + send
    helix_stream_t streams[MAX_STREAMS];
    // Reassembly for fragmented WebSocket binary messages (one msg = one frame).
    uint8_t *rx;
    size_t rx_len;
    size_t rx_cap;
    volatile bool closed;
};

// --- frame egress -----------------------------------------------------------

static esp_err_t send_frame(
    helix_stream_session_t *s, uint8_t type, uint32_t id, const uint8_t *payload, size_t len)
{
    if (s->closed) {
        return ESP_ERR_INVALID_STATE;
    }
    uint8_t header[FRAME_HEADER];
    header[0] = type;
    header[1] = (uint8_t)(id >> 24);
    header[2] = (uint8_t)(id >> 16);
    header[3] = (uint8_t)(id >> 8);
    header[4] = (uint8_t)(id);
    // esp_websocket_client_send_bin sends one binary message; to keep header and
    // payload in a single frame we assemble into one buffer.
    size_t total = FRAME_HEADER + len;
    uint8_t *buf = malloc(total);
    if (buf == NULL) {
        return ESP_ERR_NO_MEM;
    }
    memcpy(buf, header, FRAME_HEADER);
    if (len > 0) {
        memcpy(buf + FRAME_HEADER, payload, len);
    }
    int sent = esp_websocket_client_send_bin(s->ws, (const char *)buf, total, pdMS_TO_TICKS(SEND_TIMEOUT_MS));
    free(buf);
    return sent < 0 ? ESP_FAIL : ESP_OK;
}

// --- stream table -----------------------------------------------------------

static helix_stream_t *find_stream(helix_stream_session_t *s, uint32_t id)
{
    for (int i = 0; i < MAX_STREAMS; i++) {
        if (s->streams[i].active && s->streams[i].id == id) {
            return &s->streams[i];
        }
    }
    return NULL;
}

static helix_stream_t *alloc_stream(helix_stream_session_t *s, uint32_t id)
{
    for (int i = 0; i < MAX_STREAMS; i++) {
        if (!s->streams[i].active) {
            helix_stream_t *st = &s->streams[i];
            st->session = s;
            st->id = id;
            st->active = true;
            st->window = INITIAL_WINDOW;
            st->unacked = 0;
            st->user = NULL;
            if (st->window_sem == NULL) {
                st->window_sem = xSemaphoreCreateBinary();
            }
            return st;
        }
    }
    return NULL;
}

static void free_stream(helix_stream_t *st)
{
    st->active = false;
    st->user = NULL;
    if (st->window_sem != NULL) {
        xSemaphoreGive(st->window_sem);  // unblock any writer
    }
}

// --- frame dispatch ---------------------------------------------------------

static void dispatch_frame(helix_stream_session_t *s, const uint8_t *frame, size_t len)
{
    if (len < FRAME_HEADER) {
        return;
    }
    uint8_t type = frame[0];
    uint32_t id = ((uint32_t)frame[1] << 24) | ((uint32_t)frame[2] << 16) |
                  ((uint32_t)frame[3] << 8) | (uint32_t)frame[4];
    const uint8_t *payload = frame + FRAME_HEADER;
    size_t plen = len - FRAME_HEADER;

    switch (type) {
        case F_PING:
            send_frame(s, F_PONG, 0, NULL, 0);
            break;
        case F_PONG:
            break;
        case F_OPEN: {
            xSemaphoreTake(s->lock, portMAX_DELAY);
            helix_stream_t *st = alloc_stream(s, id);
            xSemaphoreGive(s->lock);
            if (st == NULL) {
                ESP_LOGW(TAG, "no free stream slot for id=%u", (unsigned)id);
                send_frame(s, F_RESET, id, (const uint8_t *)"busy", 4);
                break;
            }
            ESP_LOGI(TAG, "stream opened id=%u", (unsigned)id);
            if (s->cb.on_open) {
                s->cb.on_open(st, payload, plen, s->cb.user);
            }
            break;
        }
        case F_DATA: {
            helix_stream_t *st = find_stream(s, id);
            if (st == NULL) {
                break;
            }
            if (s->cb.on_data) {
                s->cb.on_data(st, payload, plen, s->cb.user);
            }
            // Grant credit back for what we consumed.
            st->unacked += (int)plen;
            if (st->unacked >= CREDIT_THRESHOLD) {
                uint32_t grant = (uint32_t)st->unacked;
                st->unacked = 0;
                uint8_t c[4] = {(uint8_t)(grant >> 24), (uint8_t)(grant >> 16),
                                (uint8_t)(grant >> 8), (uint8_t)grant};
                send_frame(s, F_CREDIT, id, c, 4);
            }
            break;
        }
        case F_END:
        case F_RESET: {
            helix_stream_t *st = find_stream(s, id);
            if (st == NULL) {
                break;
            }
            if (s->cb.on_stream_close) {
                s->cb.on_stream_close(st, s->cb.user);
            }
            xSemaphoreTake(s->lock, portMAX_DELAY);
            free_stream(st);
            xSemaphoreGive(s->lock);
            break;
        }
        case F_SIGNAL: {
            helix_stream_t *st = find_stream(s, id);
            if (st != NULL && s->cb.on_signal) {
                s->cb.on_signal(st, payload, plen, s->cb.user);
            }
            break;
        }
        case F_CREDIT: {
            helix_stream_t *st = find_stream(s, id);
            if (st == NULL || plen < 4) {
                break;
            }
            uint32_t n = ((uint32_t)payload[0] << 24) | ((uint32_t)payload[1] << 16) |
                         ((uint32_t)payload[2] << 8) | (uint32_t)payload[3];
            st->window += (int)n;
            xSemaphoreGive(st->window_sem);
            break;
        }
        default:
            break;
    }
}

// --- websocket event handler ------------------------------------------------

static void teardown_all_streams(helix_stream_session_t *s)
{
    xSemaphoreTake(s->lock, portMAX_DELAY);
    for (int i = 0; i < MAX_STREAMS; i++) {
        if (s->streams[i].active) {
            free_stream(&s->streams[i]);
        }
    }
    xSemaphoreGive(s->lock);
}

static void ws_event_handler(void *arg, esp_event_base_t base, int32_t event_id, void *event_data)
{
    helix_stream_session_t *s = arg;
    esp_websocket_event_data_t *data = event_data;

    switch ((esp_websocket_event_id_t)event_id) {
        case WEBSOCKET_EVENT_CONNECTED:
            ESP_LOGI(TAG, "data-plane websocket connected");
            break;
        case WEBSOCKET_EVENT_DATA:
            // Only binary (0x02) carries HelixStream frames. Reassemble fragments
            // into one full WebSocket message before decoding.
            if (data->op_code != 0x02) {
                break;
            }
            if (data->payload_offset == 0) {
                s->rx_len = 0;
            }
            if (data->payload_len > s->rx_cap) {
                uint8_t *grown = realloc(s->rx, data->payload_len);
                if (grown == NULL) {
                    ESP_LOGE(TAG, "rx realloc failed (%d bytes)", data->payload_len);
                    break;
                }
                s->rx = grown;
                s->rx_cap = data->payload_len;
            }
            if (data->data_len > 0) {
                memcpy(s->rx + data->payload_offset, data->data_ptr, data->data_len);
                s->rx_len = data->payload_offset + data->data_len;
            }
            if (s->rx_len >= (size_t)data->payload_len && data->payload_len > 0) {
                dispatch_frame(s, s->rx, s->rx_len);
                s->rx_len = 0;
            }
            break;
        case WEBSOCKET_EVENT_DISCONNECTED:
        case WEBSOCKET_EVENT_CLOSED:
        case WEBSOCKET_EVENT_ERROR:
            ESP_LOGW(TAG, "data-plane websocket closed (event=%d)", (int)event_id);
            s->closed = true;
            teardown_all_streams(s);
            if (s->cb.on_session_close) {
                s->cb.on_session_close(s, s->cb.user);
            }
            break;
        default:
            break;
    }
}

// --- public API -------------------------------------------------------------

esp_err_t helix_stream_session_start(const helix_stream_config_t *cfg, helix_stream_session_t **out)
{
    if (cfg == NULL || cfg->url == NULL || out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    helix_stream_session_t *s = calloc(1, sizeof(*s));
    if (s == NULL) {
        return ESP_ERR_NO_MEM;
    }
    s->cb = cfg->cb;
    s->lock = xSemaphoreCreateMutex();
    if (s->lock == NULL) {
        free(s);
        return ESP_ERR_NO_MEM;
    }

    esp_websocket_client_config_t ws_cfg = {
        .uri = cfg->url,
        .transport = WEBSOCKET_TRANSPORT_OVER_SSL,
        .cert_pem = cfg->root_ca_pem,
        .client_cert = cfg->client_cert_pem,
        .client_key = cfg->client_key_pem,
        .buffer_size = 4096,
        .disable_auto_reconnect = true,
        .task_stack = 6144,
    };
    s->ws = esp_websocket_client_init(&ws_cfg);
    if (s->ws == NULL) {
        vSemaphoreDelete(s->lock);
        free(s);
        return ESP_FAIL;
    }
    esp_websocket_register_events(s->ws, WEBSOCKET_EVENT_ANY, ws_event_handler, s);
    esp_err_t err = esp_websocket_client_start(s->ws);
    if (err != ESP_OK) {
        esp_websocket_client_destroy(s->ws);
        vSemaphoreDelete(s->lock);
        free(s);
        return err;
    }
    ESP_LOGI(TAG, "data-plane session dialing %s", cfg->url);
    *out = s;
    return ESP_OK;
}

void helix_stream_session_close(helix_stream_session_t *s)
{
    if (s == NULL) {
        return;
    }
    s->closed = true;
    teardown_all_streams(s);
    if (s->ws != NULL) {
        ESP_LOGI(TAG, "closing data-plane session (stop)");
        esp_websocket_client_stop(s->ws);
        ESP_LOGI(TAG, "closing data-plane session (destroy)");
        esp_websocket_client_destroy(s->ws);
        ESP_LOGI(TAG, "data-plane session torn down");
    }
    if (s->lock != NULL) {
        vSemaphoreDelete(s->lock);
    }
    free(s->rx);
    free(s);
}

int helix_stream_write(helix_stream_t *st, const uint8_t *data, size_t len)
{
    if (st == NULL || !st->active) {
        return -1;
    }
    helix_stream_session_t *s = st->session;
    size_t sent = 0;
    while (sent < len) {
        // Wait for the credit window to open.
        while (st->window <= 0) {
            if (s->closed || !st->active) {
                return (int)sent;
            }
            xSemaphoreTake(st->window_sem, pdMS_TO_TICKS(1000));
        }
        if (s->closed || !st->active) {
            return (int)sent;
        }
        size_t chunk = len - sent;
        if (chunk > (size_t)st->window) {
            chunk = (size_t)st->window;
        }
        if (chunk > MAX_CHUNK) {
            chunk = MAX_CHUNK;
        }
        if (send_frame(s, F_DATA, st->id, data + sent, chunk) != ESP_OK) {
            return (int)sent;
        }
        st->window -= (int)chunk;
        sent += chunk;
    }
    return (int)sent;
}

int helix_stream_write_nonblock(helix_stream_t *st, const uint8_t *data, size_t len)
{
    if (st == NULL || !st->active || st->session->closed) {
        return -1;
    }
    if (st->window <= 0) {
        return 0;  // window full — drop rather than block
    }
    size_t chunk = len;
    if (chunk > (size_t)st->window) {
        chunk = (size_t)st->window;
    }
    if (chunk > MAX_CHUNK) {
        chunk = MAX_CHUNK;
    }
    if (send_frame(st->session, F_DATA, st->id, data, chunk) != ESP_OK) {
        return -1;
    }
    st->window -= (int)chunk;
    return (int)chunk;
}

void helix_stream_close_write(helix_stream_t *st)
{
    if (st != NULL && st->active) {
        send_frame(st->session, F_END, st->id, NULL, 0);
    }
}

void helix_stream_set_user(helix_stream_t *st, void *user)
{
    if (st != NULL) {
        st->user = user;
    }
}

void *helix_stream_get_user(helix_stream_t *st)
{
    return st != NULL ? st->user : NULL;
}
