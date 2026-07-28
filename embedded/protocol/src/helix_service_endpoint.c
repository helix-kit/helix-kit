#include "helix_service_endpoint.h"
#include "helix_service_dispatcher_internal.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "helix_binary_channel.h"
#include "service_dispatcher.h"

#define HELIX_ENDPOINT_MAX_TRANSPORTS 4
#define HELIX_ENDPOINT_MAX_REQUEST_ROUTES 16

typedef struct {
    char request_id[HELIX_PROTOCOL_REQUEST_ID_MAX_BYTES];
    const helix_transport_t *transport;
} request_route_t;

static const char *TAG = "helix_service_endpoint";
static const helix_transport_t *s_transports[HELIX_ENDPOINT_MAX_TRANSPORTS];
static request_route_t s_routes[HELIX_ENDPOINT_MAX_REQUEST_ROUTES];
static size_t s_next_route;
static bool s_initialized;
static SemaphoreHandle_t s_lock;

static void remember_route(const char *request_id, const helix_transport_t *transport)
{
    if (request_id == NULL || request_id[0] == '\0' || transport == NULL) {
        return;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    for (size_t i = 0; i < HELIX_ENDPOINT_MAX_REQUEST_ROUTES; i++) {
        if (strcmp(s_routes[i].request_id, request_id) == 0) {
            s_routes[i].transport = transport;
            xSemaphoreGive(s_lock);
            return;
        }
    }
    request_route_t *route = &s_routes[s_next_route];
    strlcpy(route->request_id, request_id, sizeof(route->request_id));
    route->transport = transport;
    s_next_route = (s_next_route + 1) % HELIX_ENDPOINT_MAX_REQUEST_ROUTES;
    xSemaphoreGive(s_lock);
}

static const helix_transport_t *find_route(const char *request_id)
{
    if (request_id == NULL || request_id[0] == '\0') {
        return NULL;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    for (size_t i = 0; i < HELIX_ENDPOINT_MAX_REQUEST_ROUTES; i++) {
        if (strcmp(s_routes[i].request_id, request_id) == 0) {
            const helix_transport_t *transport = s_routes[i].transport;
            xSemaphoreGive(s_lock);
            return transport;
        }
    }
    xSemaphoreGive(s_lock);
    return NULL;
}

static esp_err_t send_packet(const helix_transport_t *transport, const char *json)
{
    if (transport == NULL || transport->send_packet_json == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    return transport->send_packet_json(json, transport->context);
}

static esp_err_t endpoint_response_sink(
    const char *service,
    const char *method,
    const cJSON *payload,
    const char *request_id
)
{
    char *packet_json = NULL;
    esp_err_t err = helix_protocol_build_packet_json(
        service,
        method,
        payload,
        request_id,
        &packet_json
    );
    if (err != ESP_OK) {
        return err;
    }

    const helix_transport_t *route = find_route(request_id);

    if (route != NULL) {
        err = send_packet(route, packet_json);
    } else {
        const helix_transport_t *transports[HELIX_ENDPOINT_MAX_TRANSPORTS];
        xSemaphoreTake(s_lock, portMAX_DELAY);
        memcpy(transports, s_transports, sizeof(transports));
        xSemaphoreGive(s_lock);
        err = ESP_OK;
        for (size_t i = 0; i < HELIX_ENDPOINT_MAX_TRANSPORTS; i++) {
            if (transports[i] == NULL) {
                continue;
            }
            esp_err_t send_err = send_packet(transports[i], packet_json);
            if (send_err != ESP_OK && send_err != ESP_ERR_INVALID_STATE) {
                err = send_err;
            }
        }
    }

    free(packet_json);
    return err;
}

esp_err_t helix_service_endpoint_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }
    s_lock = xSemaphoreCreateMutex();
    if (s_lock == NULL) {
        return ESP_ERR_NO_MEM;
    }
    esp_err_t err = service_dispatcher_register_response_sink(endpoint_response_sink);
    if (err == ESP_OK) {
        s_initialized = true;
    } else {
        vSemaphoreDelete(s_lock);
        s_lock = NULL;
    }
    return err;
}

esp_err_t helix_service_endpoint_attach_transport(const helix_transport_t *transport)
{
    if (transport == NULL || transport->name == NULL || transport->send_packet_json == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    for (size_t i = 0; i < HELIX_ENDPOINT_MAX_TRANSPORTS; i++) {
        if (s_transports[i] == transport) {
            xSemaphoreGive(s_lock);
            return ESP_OK;
        }
    }
    for (size_t i = 0; i < HELIX_ENDPOINT_MAX_TRANSPORTS; i++) {
        if (s_transports[i] == NULL) {
            s_transports[i] = transport;
            ESP_LOGI(TAG, "attached transport=%s", transport->name);
            xSemaphoreGive(s_lock);
            return ESP_OK;
        }
    }
    xSemaphoreGive(s_lock);
    return ESP_ERR_NO_MEM;
}

const helix_transport_t *helix_service_endpoint_binary_transport(void)
{
    if (!s_initialized) {
        return NULL;
    }
    const helix_transport_t *found = NULL;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    for (size_t i = 0; i < HELIX_ENDPOINT_MAX_TRANSPORTS; i++) {
        if (helix_binary_channel_supported(s_transports[i])) {
            found = s_transports[i];
            break;
        }
    }
    xSemaphoreGive(s_lock);
    return found;
}

esp_err_t helix_service_endpoint_receive(
    const helix_protocol_packet_t *packet,
    const helix_transport_t *source,
    void *user_data
)
{
    (void)user_data;
    if (packet == NULL || source == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    remember_route(packet->request_id, source);

    ESP_LOGI(TAG, "%s command service=%s method=%s", source->name, packet->service, packet->method);
    return service_dispatcher_handle(
        packet->service,
        packet->method,
        packet->payload,
        packet->request_id
    );
}
