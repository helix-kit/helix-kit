#include "helix_protocol.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

static const char *json_string(const cJSON *root, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    return cJSON_IsString(item) ? item->valuestring : NULL;
}

static esp_err_t copy_required(char *out, size_t out_len, const char *value)
{
    if (value == NULL || value[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }
    if (strlcpy(out, value, out_len) >= out_len) {
        return ESP_ERR_INVALID_SIZE;
    }
    return ESP_OK;
}

static esp_err_t copy_optional(char *out, size_t out_len, const char *value)
{
    out[0] = '\0';
    if (value == NULL || value[0] == '\0') {
        return ESP_OK;
    }
    if (strlcpy(out, value, out_len) >= out_len) {
        return ESP_ERR_INVALID_SIZE;
    }
    return ESP_OK;
}

static cJSON *duplicate_payload_or_empty(const cJSON *payload)
{
    if (payload != NULL && cJSON_IsObject(payload)) {
        return cJSON_Duplicate(payload, true);
    }
    return cJSON_CreateObject();
}

esp_err_t helix_protocol_parse_packet(
    const char *json,
    size_t json_len,
    helix_protocol_packet_t *out
)
{
    if (json == NULL || out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out, 0, sizeof(*out));
    char *copy = calloc(1, json_len + 1);
    if (copy == NULL) {
        return ESP_ERR_NO_MEM;
    }
    memcpy(copy, json, json_len);

    cJSON *root = cJSON_Parse(copy);
    free(copy);
    if (root == NULL || !cJSON_IsObject(root)) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_ARG;
    }

    const cJSON *message = cJSON_GetObjectItemCaseSensitive(root, "message");
    if (!cJSON_IsObject(message)) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = copy_optional(out->request_id, sizeof(out->request_id), json_string(root, "requestId"));
    if (err == ESP_OK) {
        err = copy_required(out->service, sizeof(out->service), json_string(message, "service"));
    }
    if (err == ESP_OK) {
        err = copy_required(out->method, sizeof(out->method), json_string(message, "method"));
    }
    if (err != ESP_OK) {
        cJSON_Delete(root);
        return err;
    }

    out->payload = duplicate_payload_or_empty(cJSON_GetObjectItemCaseSensitive(message, "payload"));
    cJSON_Delete(root);
    return out->payload == NULL ? ESP_ERR_NO_MEM : ESP_OK;
}

void helix_protocol_packet_free(helix_protocol_packet_t *packet)
{
    if (packet == NULL) {
        return;
    }
    cJSON_Delete(packet->payload);
    memset(packet, 0, sizeof(*packet));
}

esp_err_t helix_protocol_build_packet_json(
    const char *service,
    const char *method,
    const cJSON *payload,
    const char *request_id,
    char **out_json
)
{
    if (service == NULL || service[0] == '\0' || method == NULL || method[0] == '\0' || out_json == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    *out_json = NULL;

    cJSON *root = cJSON_CreateObject();
    cJSON *message = cJSON_CreateObject();
    cJSON *packet_payload = duplicate_payload_or_empty(payload);
    if (root == NULL || message == NULL || packet_payload == NULL) {
        cJSON_Delete(root);
        cJSON_Delete(message);
        cJSON_Delete(packet_payload);
        return ESP_ERR_NO_MEM;
    }

    if (request_id != NULL && request_id[0] != '\0') {
        cJSON_AddStringToObject(root, "requestId", request_id);
    }
    cJSON_AddStringToObject(message, "service", service);
    cJSON_AddStringToObject(message, "method", method);
    cJSON_AddItemToObject(message, "payload", packet_payload);
    cJSON_AddItemToObject(root, "message", message);

    *out_json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return *out_json == NULL ? ESP_ERR_NO_MEM : ESP_OK;
}
