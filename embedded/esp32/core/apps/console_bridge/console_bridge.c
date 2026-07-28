#include "console_bridge.h"

#include <string.h>
#include <time.h>

#include "certificates.h"
#include "cloud.h"
#include "console_contract.h"
#include "driver/uart.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "helix_stream.h"
#include "service_dispatcher.h"

// Compile-time defaults for the bridged UART (UART0 is the ESP32 console, so we
// default to UART1 on flash-safe pins). Overridable at runtime via `configure`.
#define CONSOLE_DEFAULT_UART UART_NUM_1
#define CONSOLE_DEFAULT_BAUD 115200
#define CONSOLE_DEFAULT_TX_PIN 17
#define CONSOLE_DEFAULT_RX_PIN 16

#define CONSOLE_READ_CHUNK 512
#define CONSOLE_UART_RX_BUFFER 4096
#define CONSOLE_TASK_STACK 4096
#define CONSOLE_TASK_PRIORITY 6

static const char *TAG = "console";

// UART bridge state.
static int s_uart = CONSOLE_DEFAULT_UART;
static int s_baud = CONSOLE_DEFAULT_BAUD;
static int s_tx_pin = CONSOLE_DEFAULT_TX_PIN;
static int s_rx_pin = CONSOLE_DEFAULT_RX_PIN;
static volatile bool s_running;
static TaskHandle_t s_task;

// Data-plane session state (single active session; a new `open` replaces it).
static SemaphoreHandle_t s_dp_lock;
static helix_stream_session_t *s_session;
static helix_stream_t *s_stream;  // the accepted console stream, if any
static mqtt_cert_bundle_t s_bundle;
static char s_session_id[80];
static char s_data_url[320];
static long s_session_created_at;  // epoch seconds (SNTP), for `list`

// --- payload builders -------------------------------------------------------

static cJSON *build_config_payload(bool ok)
{
    cJSON *p = cJSON_CreateObject();
    if (p == NULL) {
        return NULL;
    }
    cJSON_AddBoolToObject(p, "ok", ok);
    cJSON_AddNumberToObject(p, "uart", s_uart);
    cJSON_AddNumberToObject(p, "baud", s_baud);
    cJSON_AddNumberToObject(p, "txPin", s_tx_pin);
    cJSON_AddNumberToObject(p, "rxPin", s_rx_pin);
    return p;
}

static cJSON *build_session_payload(const char *session_id)
{
    cJSON *p = cJSON_CreateObject();
    if (p != NULL) {
        cJSON_AddStringToObject(p, "sessionId", session_id != NULL ? session_id : "");
    }
    return p;
}

// --- UART bridge ------------------------------------------------------------

// Reads target-UART bytes and pushes them to the active data-plane stream.
static void console_read_task(void *arg)
{
    (void)arg;
    uint8_t buf[CONSOLE_READ_CHUNK];
    while (s_running) {
        int n = uart_read_bytes((uart_port_t)s_uart, buf, sizeof(buf), pdMS_TO_TICKS(20));
        if (n <= 0) {
            continue;
        }
        xSemaphoreTake(s_dp_lock, portMAX_DELAY);
        if (s_stream != NULL) {
            helix_stream_write_nonblock(s_stream, buf, (size_t)n);
        }
        xSemaphoreGive(s_dp_lock);
    }
    s_task = NULL;
    vTaskDelete(NULL);
}

static esp_err_t start_bridge(void)
{
    uart_config_t cfg = {
        .baud_rate = s_baud,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    esp_err_t err = uart_driver_install((uart_port_t)s_uart, CONSOLE_UART_RX_BUFFER, 0, 0, NULL, 0);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }
    if ((err = uart_param_config((uart_port_t)s_uart, &cfg)) != ESP_OK) {
        return err;
    }
    if ((err = uart_set_pin((uart_port_t)s_uart, s_tx_pin, s_rx_pin, UART_PIN_NO_CHANGE,
                            UART_PIN_NO_CHANGE)) != ESP_OK) {
        return err;
    }
    s_running = true;
    if (xTaskCreate(console_read_task, "helix_console", CONSOLE_TASK_STACK, NULL,
                    CONSOLE_TASK_PRIORITY, &s_task) != pdPASS) {
        s_running = false;
        s_task = NULL;
        return ESP_ERR_NO_MEM;
    }
    ESP_LOGI(TAG, "console bridge up: UART%d %d baud tx=%d rx=%d", s_uart, s_baud, s_tx_pin, s_rx_pin);
    return ESP_OK;
}

static void stop_bridge(void)
{
    if (!s_running && s_task == NULL) {
        return;
    }
    s_running = false;
    for (int i = 0; i < 20 && s_task != NULL; i++) {
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    uart_driver_delete((uart_port_t)s_uart);
}

// --- data-plane session -----------------------------------------------------

// Callbacks run on the websocket task. s_dp_lock guards s_stream/s_session.
static void on_open(helix_stream_t *stream, const uint8_t *meta, size_t meta_len, void *user)
{
    (void)meta;
    (void)meta_len;
    (void)user;
    xSemaphoreTake(s_dp_lock, portMAX_DELAY);
    s_stream = stream;
    xSemaphoreGive(s_dp_lock);
    ESP_LOGI(TAG, "console stream bound to session %s", s_session_id);
}

static void on_data(helix_stream_t *stream, const uint8_t *data, size_t len, void *user)
{
    (void)stream;
    (void)user;
    // Host keystrokes -> target UART.
    uart_write_bytes((uart_port_t)s_uart, (const char *)data, len);
}

static void on_stream_close(helix_stream_t *stream, void *user)
{
    (void)user;
    xSemaphoreTake(s_dp_lock, portMAX_DELAY);
    if (s_stream == stream) {
        s_stream = NULL;
    }
    xSemaphoreGive(s_dp_lock);
}

static void on_session_close(helix_stream_session_t *session, void *user)
{
    (void)session;
    (void)user;
    xSemaphoreTake(s_dp_lock, portMAX_DELAY);
    s_stream = NULL;
    xSemaphoreGive(s_dp_lock);
    ESP_LOGI(TAG, "data-plane session closed");
}

// Detaches the current session/stream/bundle under s_dp_lock and hands them back
// so the caller can close them OUTSIDE the lock. Closing a session stops the
// websocket task, which may itself be blocked on s_dp_lock inside a callback —
// so freeing under the lock would deadlock.
static helix_stream_session_t *detach_session_locked(mqtt_cert_bundle_t *out_bundle)
{
    helix_stream_session_t *old = s_session;
    *out_bundle = s_bundle;
    s_session = NULL;
    s_stream = NULL;
    memset(&s_bundle, 0, sizeof(s_bundle));
    s_session_id[0] = '\0';
    return old;
}

// Detaches then closes the current session. Must NOT be called with s_dp_lock held.
static void close_active_session(void)
{
    xSemaphoreTake(s_dp_lock, portMAX_DELAY);
    mqtt_cert_bundle_t old_bundle;
    helix_stream_session_t *old = detach_session_locked(&old_bundle);
    xSemaphoreGive(s_dp_lock);
    if (old != NULL) {
        helix_stream_session_close(old);
    }
    mqtt_cert_bundle_free(&old_bundle);
}

static esp_err_t handle_open(const helix_service_invocation_t *invocation, const cJSON *payload)
{
    console_open_session_request_t req;
    if (console_parse_open_session_request(payload, &req) != ESP_OK || req.session_id == NULL) {
        return service_dispatcher_fail(invocation, "invalid open request");
    }
    if (req.transport != NULL && req.transport[0] != '\0' && strcmp(req.transport, "relay") != 0) {
        return service_dispatcher_fail(invocation, "only relay transport is supported");
    }
    if (req.data_url == NULL || req.data_url[0] == '\0') {
        return service_dispatcher_fail(invocation, "dataUrl is required");
    }

    close_active_session();  // tear down any prior session (outside s_dp_lock)

    helix_cloud_config_t cloud;
    mqtt_cert_bundle_t bundle;
    memset(&bundle, 0, sizeof(bundle));
    esp_err_t err = cloud_config_load(&cloud);
    if (err == ESP_OK) {
        err = mqtt_cert_bundle_load_or_enroll(&cloud, &bundle);
    }
    if (err != ESP_OK) {
        mqtt_cert_bundle_free(&bundle);
        return service_dispatcher_fail(invocation, "device certificate unavailable");
    }

    xSemaphoreTake(s_dp_lock, portMAX_DELAY);
    strlcpy(s_session_id, req.session_id, sizeof(s_session_id));
    strlcpy(s_data_url, req.data_url, sizeof(s_data_url));
    s_session_created_at = (long)time(NULL);
    s_bundle = bundle;  // ownership moves to the session
    helix_stream_config_t sc = {
        .url = s_data_url,
        .client_cert_pem = s_bundle.certificate_pem,
        .client_key_pem = s_bundle.private_key_pem,
        .root_ca_pem = s_bundle.root_ca_pem,
        .cb = {
            .on_open = on_open,
            .on_data = on_data,
            .on_signal = NULL,
            .on_stream_close = on_stream_close,
            .on_session_close = on_session_close,
            .user = NULL,
        },
    };
    err = helix_stream_session_start(&sc, &s_session);
    if (err != ESP_OK) {
        s_session = NULL;
        mqtt_cert_bundle_free(&s_bundle);
        memset(&s_bundle, 0, sizeof(s_bundle));
        s_session_id[0] = '\0';
        xSemaphoreGive(s_dp_lock);
        return service_dispatcher_fail(invocation, "data-plane dial failed");
    }
    ESP_LOGI(TAG, "opened console session %s -> %s", s_session_id, s_data_url);
    xSemaphoreGive(s_dp_lock);
    return service_dispatcher_respond(
        invocation, CONSOLE_OPENED_MESSAGE, build_session_payload(req.session_id));
}

static esp_err_t handle_close(const helix_service_invocation_t *invocation, const cJSON *payload)
{
    const cJSON *sid = payload != NULL ? cJSON_GetObjectItemCaseSensitive(payload, "sessionId") : NULL;
    char requested[80] = {0};
    if (cJSON_IsString(sid)) {
        strlcpy(requested, sid->valuestring, sizeof(requested));
    }
    close_active_session();
    return service_dispatcher_respond(invocation, CONSOLE_CLOSED_MESSAGE, build_session_payload(requested));
}

static esp_err_t handle_list(const helix_service_invocation_t *invocation)
{
    cJSON *payload = cJSON_CreateObject();
    cJSON *sessions = cJSON_CreateArray();
    if (payload == NULL || sessions == NULL) {
        cJSON_Delete(payload);
        cJSON_Delete(sessions);
        return service_dispatcher_fail(invocation, "out of memory");
    }
    xSemaphoreTake(s_dp_lock, portMAX_DELAY);
    if (s_session != NULL && s_session_id[0] != '\0') {
        cJSON *info = cJSON_CreateObject();
        cJSON_AddStringToObject(info, "sessionId", s_session_id);
        cJSON_AddNumberToObject(info, "createdAt", (double)s_session_created_at);
        cJSON_AddNumberToObject(info, "terminals", s_stream != NULL ? 1 : 0);
        cJSON_AddItemToArray(sessions, info);
    }
    xSemaphoreGive(s_dp_lock);
    cJSON_AddItemToObject(payload, "sessions", sessions);
    return service_dispatcher_respond(invocation, CONSOLE_SESSIONS_MESSAGE, payload);
}

static esp_err_t handle_configure(const helix_service_invocation_t *invocation, const cJSON *payload)
{
    const cJSON *v;
    if (payload != NULL) {
        if ((v = cJSON_GetObjectItemCaseSensitive(payload, "uart")) && cJSON_IsNumber(v)) {
            s_uart = v->valueint;
        }
        if ((v = cJSON_GetObjectItemCaseSensitive(payload, "baud")) && cJSON_IsNumber(v)) {
            s_baud = v->valueint;
        }
        if ((v = cJSON_GetObjectItemCaseSensitive(payload, "txPin")) && cJSON_IsNumber(v)) {
            s_tx_pin = v->valueint;
        }
        if ((v = cJSON_GetObjectItemCaseSensitive(payload, "rxPin")) && cJSON_IsNumber(v)) {
            s_rx_pin = v->valueint;
        }
    }
    stop_bridge();
    esp_err_t err = start_bridge();
    if (err != ESP_OK) {
        return service_dispatcher_fail(invocation, esp_err_to_name(err));
    }
    return service_dispatcher_respond(invocation, CONSOLE_CONFIGURED_MESSAGE, build_config_payload(true));
}

static esp_err_t console_handle_command(
    const helix_service_invocation_t *invocation, const char *method, const cJSON *payload)
{
    if (strcmp(method, CONSOLE_OPEN_METHOD) == 0) {
        return handle_open(invocation, payload);
    }
    if (strcmp(method, CONSOLE_CLOSE_METHOD) == 0) {
        return handle_close(invocation, payload);
    }
    if (strcmp(method, CONSOLE_LIST_METHOD) == 0) {
        return handle_list(invocation);
    }
    if (strcmp(method, CONSOLE_CONFIGURE_METHOD) == 0) {
        return handle_configure(invocation, payload);
    }
    return service_dispatcher_fail(invocation, "unsupported console command");
}

esp_err_t console_bridge_start(void)
{
    ESP_LOGI(TAG, "starting console UART-bridge service");
    if (s_dp_lock == NULL) {
        s_dp_lock = xSemaphoreCreateMutex();
        if (s_dp_lock == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }
    esp_err_t err = service_dispatcher_register(CONSOLE_SERVICE, console_handle_command);
    if (err != ESP_OK) {
        return err;
    }
    // Bring the UART bridge up with defaults so the target console is captured
    // from boot; bytes flow once an `open` session attaches a data-plane stream.
    err = start_bridge();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "console bridge auto-start failed: %s", esp_err_to_name(err));
    }
    return ESP_OK;
}
