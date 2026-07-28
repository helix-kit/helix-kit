#include "service_dispatcher.h"
#include "helix_service_dispatcher_internal.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "helix_protocol.h"

#define MAX_SERVICE_HANDLERS 8
#define MAX_RESPONSE_SINKS 4

typedef struct {
    const char *service;
    service_command_handler_t handler;
} service_handler_entry_t;

typedef struct {
    char service[HELIX_PROTOCOL_SERVICE_MAX_BYTES];
    char request_id[HELIX_PROTOCOL_REQUEST_ID_MAX_BYTES];
    bool response_enabled;
} invocation_data_t;

_Static_assert(sizeof(invocation_data_t) <= sizeof(helix_service_invocation_t),
               "helix_service_invocation_t storage is too small");

static invocation_data_t *invocation_data(helix_service_invocation_t *invocation)
{
    return (invocation_data_t *)invocation->_opaque;
}

static const invocation_data_t *const_invocation_data(const helix_service_invocation_t *invocation)
{
    return (const invocation_data_t *)invocation->_opaque;
}

static const char *TAG = "service_dispatcher";
static service_handler_entry_t s_handlers[MAX_SERVICE_HANDLERS];
static service_response_sink_t s_response_sinks[MAX_RESPONSE_SINKS];

static esp_err_t create_invocation(
    helix_service_invocation_t *out,
    const char *service,
    const char *request_id,
    bool response_enabled
)
{
    if (out == NULL || service == NULL || service[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }
    memset(out, 0, sizeof(*out));
    invocation_data_t *data = invocation_data(out);
    if (strlcpy(data->service, service, sizeof(data->service)) >= sizeof(data->service)) {
        return ESP_ERR_INVALID_SIZE;
    }
    if (request_id != NULL && request_id[0] != '\0' &&
        strlcpy(data->request_id, request_id, sizeof(data->request_id)) >= sizeof(data->request_id)) {
        return ESP_ERR_INVALID_SIZE;
    }
    data->response_enabled = response_enabled;
    return ESP_OK;
}

static service_command_handler_t find_handler(const char *service)
{
    for (size_t i = 0; i < MAX_SERVICE_HANDLERS; i++) {
        if (s_handlers[i].service != NULL && strcmp(s_handlers[i].service, service) == 0) {
            return s_handlers[i].handler;
        }
    }
    return NULL;
}

static esp_err_t dispatch(
    const helix_service_invocation_t *invocation,
    const char *method,
    const cJSON *payload
)
{
    if (invocation == NULL || method == NULL || method[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }
    const invocation_data_t *data = const_invocation_data(invocation);
    service_command_handler_t handler = find_handler(data->service);
    if (handler == NULL) {
        return service_dispatcher_fail(invocation, "service handler not found");
    }
    return handler(invocation, method, payload);
}

esp_err_t service_dispatcher_register(const char *service, service_command_handler_t handler)
{
    if (service == NULL || service[0] == '\0' || handler == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    for (size_t i = 0; i < MAX_SERVICE_HANDLERS; i++) {
        if (s_handlers[i].service != NULL && strcmp(s_handlers[i].service, service) == 0) {
            s_handlers[i].handler = handler;
            return ESP_OK;
        }
    }
    for (size_t i = 0; i < MAX_SERVICE_HANDLERS; i++) {
        if (s_handlers[i].service == NULL) {
            s_handlers[i].service = service;
            s_handlers[i].handler = handler;
            ESP_LOGI(TAG, "registered service handler service=%s", service);
            return ESP_OK;
        }
    }
    return ESP_ERR_NO_MEM;
}

esp_err_t service_dispatcher_register_response_sink(service_response_sink_t sink)
{
    if (sink == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    for (size_t i = 0; i < MAX_RESPONSE_SINKS; i++) {
        if (s_response_sinks[i] == sink) {
            return ESP_OK;
        }
    }
    for (size_t i = 0; i < MAX_RESPONSE_SINKS; i++) {
        if (s_response_sinks[i] == NULL) {
            s_response_sinks[i] = sink;
            return ESP_OK;
        }
    }
    return ESP_ERR_NO_MEM;
}

esp_err_t service_dispatcher_call(const char *service, const char *method, const cJSON *payload)
{
    helix_service_invocation_t invocation;
    esp_err_t err = create_invocation(&invocation, service, NULL, false);
    return err == ESP_OK ? dispatch(&invocation, method, payload) : err;
}

esp_err_t service_dispatcher_handle(
    const char *service,
    const char *method,
    const cJSON *payload,
    const char *request_id
)
{
    helix_service_invocation_t invocation;
    esp_err_t err = create_invocation(&invocation, service, request_id, true);
    return err == ESP_OK ? dispatch(&invocation, method, payload) : err;
}

static esp_err_t emit(
    const char *service,
    const char *method,
    cJSON *payload,
    const char *request_id
)
{
    if (service == NULL || method == NULL || payload == NULL) {
        cJSON_Delete(payload);
        return ESP_ERR_INVALID_ARG;
    }
    esp_err_t err = ESP_OK;
    for (size_t i = 0; i < MAX_RESPONSE_SINKS; i++) {
        if (s_response_sinks[i] == NULL) {
            continue;
        }
        esp_err_t sink_err = s_response_sinks[i](service, method, payload, request_id);
        if (sink_err != ESP_OK && sink_err != ESP_ERR_INVALID_STATE) {
            err = sink_err;
        }
    }
    cJSON_Delete(payload);
    return err;
}

esp_err_t service_dispatcher_respond(
    const helix_service_invocation_t *invocation,
    const char *method,
    cJSON *payload
)
{
    if (invocation == NULL) {
        cJSON_Delete(payload);
        return ESP_ERR_INVALID_ARG;
    }
    const invocation_data_t *data = const_invocation_data(invocation);
    if (!data->response_enabled) {
        cJSON_Delete(payload);
        return ESP_OK;
    }
    return emit(data->service, method, payload, data->request_id);
}

esp_err_t service_dispatcher_publish(const char *service, const char *method, cJSON *payload)
{
    return emit(service, method, payload, NULL);
}

esp_err_t service_dispatcher_fail(
    const helix_service_invocation_t *invocation,
    const char *error
)
{
    if (invocation == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    const invocation_data_t *data = const_invocation_data(invocation);
    cJSON *payload = cJSON_CreateObject();
    if (payload == NULL) {
        return ESP_ERR_NO_MEM;
    }
    cJSON_AddStringToObject(payload, "error", error != NULL ? error : "unknown error");
    char error_method[96];
    if (snprintf(error_method, sizeof(error_method), "%s-error", data->service) >= sizeof(error_method)) {
        strlcpy(error_method, "service-error", sizeof(error_method));
    }
    return service_dispatcher_respond(invocation, error_method, payload);
}
