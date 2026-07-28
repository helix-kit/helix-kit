#include "helix_ui_service.h"

#include <string.h>

#include "esp_log.h"
#include "helix_ui.h"
#include "service_dispatcher.h"
#include "ui_contract.h"

static const char *TAG = "helix_ui_service";

static esp_err_t respond_info(const helix_service_invocation_t *invocation)
{
    uint16_t width = 0;
    uint16_t height = 0;
    helix_ui_size(&width, &height);

    cJSON *payload = cJSON_CreateObject();
    if (payload == NULL) {
        return ESP_ERR_NO_MEM;
    }
    cJSON_AddNumberToObject(payload, "width", width);
    cJSON_AddNumberToObject(payload, "height", height);
    cJSON_AddStringToObject(payload, "format", "rgb565");
    cJSON_AddBoolToObject(payload, "ready", helix_ui_ready());
    return service_dispatcher_respond(invocation, UI_INFO_MESSAGE, payload);
}

static esp_err_t respond_ack(const helix_service_invocation_t *invocation)
{
    cJSON *payload = cJSON_CreateObject();
    if (payload == NULL) {
        return ESP_ERR_NO_MEM;
    }
    cJSON_AddBoolToObject(payload, "ok", true);
    return service_dispatcher_respond(invocation, UI_ACK_MESSAGE, payload);
}

static esp_err_t handle_refresh(const helix_service_invocation_t *invocation)
{
    esp_err_t err = helix_ui_refresh();
    if (err != ESP_OK) {
        return service_dispatcher_fail(invocation, "ui not started");
    }
    return respond_info(invocation);
}

static esp_err_t handle_pointer(
    const helix_service_invocation_t *invocation,
    const cJSON *payload
)
{
    ui_ui_pointer_request_t request = {0};
    if (ui_parse_ui_pointer_request(payload, &request) != ESP_OK) {
        return service_dispatcher_fail(invocation, "invalid pointer request");
    }

    uint16_t width = 0;
    uint16_t height = 0;
    helix_ui_size(&width, &height);
    if (request.x < 0 || request.y < 0 || request.x >= width || request.y >= height) {
        return service_dispatcher_fail(invocation, "pointer outside the screen");
    }

    const helix_ui_pointer_t event = {
        .x = (uint16_t)request.x,
        .y = (uint16_t)request.y,
        .pressed = request.pressed,
    };
    if (helix_ui_input_push_pointer(&event) != ESP_OK) {
        return service_dispatcher_fail(invocation, "pointer queue full");
    }
    return respond_ack(invocation);
}

static esp_err_t handle_command(
    const helix_service_invocation_t *invocation,
    const char *method,
    const cJSON *payload
)
{
    if (strcmp(method, UI_INFO_METHOD) == 0) {
        return respond_info(invocation);
    }
    if (strcmp(method, UI_REFRESH_METHOD) == 0) {
        return handle_refresh(invocation);
    }
    if (strcmp(method, UI_POINTER_METHOD) == 0) {
        return handle_pointer(invocation, payload);
    }
    return service_dispatcher_fail(invocation, "unsupported ui command");
}

esp_err_t helix_ui_service_register(void)
{
    ESP_LOGI(TAG, "registering ui service");
    return service_dispatcher_register(UI_SERVICE, handle_command);
}
