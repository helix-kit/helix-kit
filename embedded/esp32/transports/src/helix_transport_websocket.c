#include "sdkconfig.h"

#if CONFIG_HELIX_TRANSPORT_WEBSOCKET

#include "helix_transport_websocket.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "esp_http_server.h"
#include "esp_log.h"

static const char *TAG = "helix_websocket_transport";

static httpd_handle_t s_server;
static helix_websocket_transport_config_t s_config;
static char s_path[64];

static esp_err_t websocket_send_packet_json(const char *json, void *context)
{
    (void)context;
    return helix_websocket_transport_send_packet_json(json);
}

static const helix_transport_t s_transport = {
    .name = "WebSocket",
    .send_packet_json = websocket_send_packet_json,
};

static const char *configured_path(void)
{
    return s_path[0] != '\0' ? s_path : HELIX_WEBSOCKET_DEFAULT_PATH;
}

static esp_err_t dispatch_websocket_text(const char *json, size_t json_len)
{
    if (json == NULL || json_len == 0 || s_config.on_packet == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    helix_protocol_packet_t packet = {0};
    esp_err_t err = helix_protocol_parse_packet(json, json_len, &packet);
    if (err == ESP_OK) {
        err = s_config.on_packet(&packet, &s_transport, s_config.user_data);
    }
    helix_protocol_packet_free(&packet);
    return err;
}

static esp_err_t websocket_handler(httpd_req_t *req)
{
    if (req->method == HTTP_GET) {
        ESP_LOGI(TAG, "client connected fd=%d", httpd_req_to_sockfd(req));
        return ESP_OK;
    }

    httpd_ws_frame_t frame = {
        .type = HTTPD_WS_TYPE_TEXT,
    };
    esp_err_t err = httpd_ws_recv_frame(req, &frame, 0);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "failed reading websocket frame length: %s", esp_err_to_name(err));
        return err;
    }
    if (frame.type == HTTPD_WS_TYPE_CLOSE) {
        ESP_LOGI(TAG, "client closed fd=%d", httpd_req_to_sockfd(req));
        return ESP_OK;
    }
    if (frame.type != HTTPD_WS_TYPE_TEXT) {
        return ESP_OK;
    }

    size_t max_frame_bytes = s_config.frame_bytes > 0
        ? s_config.frame_bytes
        : HELIX_WEBSOCKET_DEFAULT_FRAME_BYTES;
    if (frame.len == 0 || frame.len >= max_frame_bytes) {
        ESP_LOGW(TAG, "websocket frame length %u exceeds limit %u", (unsigned)frame.len, (unsigned)max_frame_bytes);
        return ESP_ERR_INVALID_SIZE;
    }

    char *payload = calloc(1, frame.len + 1);
    if (payload == NULL) {
        return ESP_ERR_NO_MEM;
    }
    frame.payload = (uint8_t *)payload;
    err = httpd_ws_recv_frame(req, &frame, frame.len);
    if (err == ESP_OK) {
        err = dispatch_websocket_text(payload, frame.len);
        if (err != ESP_OK && err != ESP_ERR_NOT_SUPPORTED) {
            ESP_LOGW(TAG, "websocket packet handler failed: %s", esp_err_to_name(err));
        }
    }
    free(payload);
    return err == ESP_ERR_NOT_SUPPORTED ? ESP_OK : err;
}

esp_err_t helix_websocket_transport_start(const helix_websocket_transport_config_t *config)
{
    if (config == NULL || config->on_packet == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_server != NULL) {
        return ESP_OK;
    }

    s_config = *config;
    const char *path = config->path != NULL && config->path[0] != '\0'
        ? config->path
        : HELIX_WEBSOCKET_DEFAULT_PATH;
    if (strlcpy(s_path, path, sizeof(s_path)) >= sizeof(s_path)) {
        return ESP_ERR_INVALID_SIZE;
    }

    httpd_config_t http_config = HTTPD_DEFAULT_CONFIG();
    http_config.server_port = config->port > 0 ? config->port : HELIX_WEBSOCKET_DEFAULT_PORT;
    http_config.uri_match_fn = httpd_uri_match_wildcard;

    esp_err_t err = httpd_start(&s_server, &http_config);
    if (err != ESP_OK) {
        s_server = NULL;
        return err;
    }

    httpd_uri_t ws_uri = {
        .uri = configured_path(),
        .method = HTTP_GET,
        .handler = websocket_handler,
        .user_ctx = NULL,
        .is_websocket = true,
    };
    err = httpd_register_uri_handler(s_server, &ws_uri);
    if (err != ESP_OK) {
        httpd_stop(s_server);
        s_server = NULL;
        return err;
    }

    ESP_LOGI(TAG, "websocket transport listening on port=%u path=%s", http_config.server_port, configured_path());
    return ESP_OK;
}

esp_err_t helix_websocket_transport_send_packet_json(const char *json)
{
    if (s_server == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (json == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t max_clients = CONFIG_LWIP_MAX_SOCKETS;
    int client_fds[CONFIG_LWIP_MAX_SOCKETS];
    esp_err_t err = httpd_get_client_list(s_server, &max_clients, client_fds);
    if (err != ESP_OK) {
        return err;
    }

    httpd_ws_frame_t frame = {
        .final = true,
        .fragmented = false,
        .type = HTTPD_WS_TYPE_TEXT,
        .payload = (uint8_t *)json,
        .len = strlen(json),
    };

    esp_err_t result = ESP_ERR_INVALID_STATE;
    for (size_t i = 0; i < max_clients; i++) {
        int fd = client_fds[i];
        if (httpd_ws_get_fd_info(s_server, fd) != HTTPD_WS_CLIENT_WEBSOCKET) {
            continue;
        }
        esp_err_t send_err = httpd_ws_send_frame_async(s_server, fd, &frame);
        if (send_err == ESP_OK) {
            result = ESP_OK;
        } else if (send_err != ESP_ERR_INVALID_STATE) {
            result = send_err;
        }
    }
    return result;
}

bool helix_websocket_transport_is_started(void)
{
    return s_server != NULL;
}

const helix_transport_t *helix_websocket_transport(void)
{
    return &s_transport;
}

#endif /* CONFIG_HELIX_TRANSPORT_WEBSOCKET */
