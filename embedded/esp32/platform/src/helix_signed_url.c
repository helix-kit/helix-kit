#include "helix_signed_url.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "certificates.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"

#define SIGNED_URL_HTTP_BUFFER_BYTES 4096
#define SIGNED_URL_HTTP_TIMEOUT_MS 60000
#define SIGNED_URL_RESPONSE_LIMIT_BYTES 4096

typedef struct {
    char *data;
    size_t len;
    size_t cap;
} http_response_buffer_t;

static const char *TAG = "signed_url";

static const char *json_string(const cJSON *root, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    return cJSON_IsString(item) ? item->valuestring : NULL;
}

static char *join_url(const char *base, const char *path)
{
    const bool base_has_slash = base[strlen(base) - 1] == '/';
    const bool path_has_slash = path[0] == '/';
    const char *separator = (base_has_slash || path_has_slash) ? "" : "/";

    if (base_has_slash && path_has_slash) {
        path++;
    }

    const size_t len = strlen(base) + strlen(separator) + strlen(path) + 1;
    char *url = calloc(1, len);
    if (url == NULL) {
        return NULL;
    }
    snprintf(url, len, "%s%s%s", base, separator, path);
    return url;
}

static char *build_auth_header(const helix_cloud_config_t *config)
{
    const char *prefix = "Bearer ";
    const size_t len = strlen(prefix) + strlen(config->device_token) + 1;
    char *header = calloc(1, len);
    if (header == NULL) {
        return NULL;
    }
    snprintf(header, len, "%s%s", prefix, config->device_token);
    return header;
}

static esp_err_t http_response_event_handler(esp_http_client_event_t *evt)
{
    if (evt->event_id != HTTP_EVENT_ON_DATA || evt->data_len <= 0) {
        return ESP_OK;
    }

    http_response_buffer_t *buffer = (http_response_buffer_t *)evt->user_data;
    if (buffer == NULL) {
        return ESP_FAIL;
    }
    if (buffer->len + evt->data_len + 1 > buffer->cap) {
        ESP_LOGE(TAG, "signed URL session response exceeds %u bytes", SIGNED_URL_RESPONSE_LIMIT_BYTES);
        return ESP_FAIL;
    }

    memcpy(buffer->data + buffer->len, evt->data, evt->data_len);
    buffer->len += evt->data_len;
    buffer->data[buffer->len] = '\0';
    return ESP_OK;
}

static esp_err_t build_request_body(const helix_signed_url_request_t *request, char **out)
{
    cJSON *body = cJSON_CreateObject();
    if (body == NULL) {
        return ESP_ERR_NO_MEM;
    }

    cJSON_AddStringToObject(body, "path", request->object_path);
    if (request->include_device_id) {
        cJSON_AddStringToObject(body, "deviceId", request->cloud_config->device_id);
    }
    if (request->content_type != NULL && request->content_type[0] != '\0') {
        cJSON_AddStringToObject(body, "contentType", request->content_type);
    }

    *out = cJSON_PrintUnformatted(body);
    cJSON_Delete(body);
    return *out != NULL ? ESP_OK : ESP_ERR_NO_MEM;
}

static esp_err_t parse_signed_url_response(const char *json, helix_signed_url_t *signed_url)
{
    cJSON *root = cJSON_Parse(json);
    if (root == NULL) {
        return ESP_ERR_INVALID_RESPONSE;
    }

    cJSON *request = cJSON_GetObjectItemCaseSensitive(root, "request");
    cJSON *source = cJSON_IsObject(request) ? request : root;
    const char *url = json_string(source, "url");
    const char *method = json_string(source, "method");
    cJSON *headers = cJSON_GetObjectItemCaseSensitive(source, "headers");

    if (url == NULL || strlen(url) >= sizeof(signed_url->url)) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_RESPONSE;
    }
    if (method != NULL && strlen(method) >= sizeof(signed_url->method)) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_RESPONSE;
    }

    memset(signed_url, 0, sizeof(*signed_url));
    strlcpy(signed_url->url, url, sizeof(signed_url->url));
    strlcpy(signed_url->method, method != NULL ? method : "GET", sizeof(signed_url->method));

    if (cJSON_IsObject(headers)) {
        char *headers_json = cJSON_PrintUnformatted(headers);
        if (headers_json == NULL) {
            cJSON_Delete(root);
            return ESP_ERR_NO_MEM;
        }
        if (strlen(headers_json) >= sizeof(signed_url->headers_json)) {
            free(headers_json);
            cJSON_Delete(root);
            return ESP_ERR_INVALID_SIZE;
        }
        strlcpy(signed_url->headers_json, headers_json, sizeof(signed_url->headers_json));
        free(headers_json);
    }

    cJSON_Delete(root);
    return ESP_OK;
}

esp_err_t helix_signed_url_request(
    const helix_signed_url_request_t *request,
    helix_signed_url_t *signed_url
)
{
    if (request == NULL ||
        request->cloud_config == NULL ||
        request->session_path == NULL ||
        request->object_path == NULL ||
        signed_url == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    char *session_url = join_url(request->cloud_config->api_url, request->session_path);
    char *auth_header = build_auth_header(request->cloud_config);
    char *body_json = NULL;
    mqtt_cert_bundle_t cert_bundle = {0};
    http_response_buffer_t response = {
        .data = calloc(1, SIGNED_URL_RESPONSE_LIMIT_BYTES),
        .len = 0,
        .cap = SIGNED_URL_RESPONSE_LIMIT_BYTES,
    };
    esp_err_t err = build_request_body(request, &body_json);
    if (err != ESP_OK || session_url == NULL || auth_header == NULL || response.data == NULL) {
        free(session_url);
        free(auth_header);
        free(body_json);
        free(response.data);
        return err != ESP_OK ? err : ESP_ERR_NO_MEM;
    }

    err = mqtt_cert_bundle_load_or_enroll(request->cloud_config, &cert_bundle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "cloud certificate bundle unavailable for signed URL request: %s", esp_err_to_name(err));
        free(session_url);
        free(auth_header);
        free(body_json);
        free(response.data);
        return err;
    }

    esp_http_client_config_t http_config = {
        .url = session_url,
        .method = HTTP_METHOD_POST,
        .event_handler = http_response_event_handler,
        .user_data = &response,
        .timeout_ms = SIGNED_URL_HTTP_TIMEOUT_MS,
        .buffer_size = SIGNED_URL_HTTP_BUFFER_BYTES,
        .buffer_size_tx = SIGNED_URL_HTTP_BUFFER_BYTES,
        .cert_pem = cert_bundle.root_ca_pem,
        .client_cert_pem = cert_bundle.certificate_pem,
        .client_key_pem = cert_bundle.private_key_pem,
        .crt_bundle_attach = cert_bundle.root_ca_pem == NULL ? esp_crt_bundle_attach : NULL,
    };
    esp_http_client_handle_t client = esp_http_client_init(&http_config);
    if (client == NULL) {
        mqtt_cert_bundle_free(&cert_bundle);
        free(session_url);
        free(auth_header);
        free(body_json);
        free(response.data);
        return ESP_FAIL;
    }

    esp_http_client_set_header(client, "Authorization", auth_header);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "Accept", "application/json");
    esp_http_client_set_header(client, "Accept-Encoding", "identity");
    esp_http_client_set_header(client, "Connection", "close");
    esp_http_client_set_post_field(client, body_json, strlen(body_json));

    ESP_LOGI(TAG, "requesting signed URL session from %s", session_url);
    err = esp_http_client_perform(client);
    const int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    mqtt_cert_bundle_free(&cert_bundle);
    free(session_url);
    free(auth_header);
    free(body_json);

    if (err == ESP_ERR_HTTP_EAGAIN && status >= 200 && status < 300 && response.len > 0) {
        err = ESP_OK;
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "signed URL session request failed: %s", esp_err_to_name(err));
        free(response.data);
        return err;
    }
    if (status < 200 || status >= 300) {
        ESP_LOGE(TAG, "signed URL session HTTP %d: %s", status, response.data);
        free(response.data);
        return ESP_FAIL;
    }

    err = parse_signed_url_response(response.data, signed_url);
    free(response.data);
    return err;
}
