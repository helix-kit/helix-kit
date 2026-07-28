#include "gpio_control.h"

#include <stdio.h>
#include <string.h>

#include "driver/gpio.h"
#include "esp_log.h"
#include "gpio_control_contract.h"
#include "service_dispatcher.h"
#include "status_display.h"
#include "status_display_contract.h"

static const char *TAG = "gpio_control";

static bool is_safe_gpio(int pin)
{
    if (pin < 0 || pin > 39) {
        return false;
    }
    return pin < 6 || pin > 11;
}

static esp_err_t add_gpio_pin_state(cJSON *pins, int pin)
{
    cJSON *state = cJSON_CreateObject();
    if (state == NULL) {
        return ESP_ERR_NO_MEM;
    }
    cJSON_AddNumberToObject(state, "pin", pin);
    cJSON_AddNumberToObject(state, "level", gpio_get_level((gpio_num_t)pin));
    cJSON_AddItemToArray(pins, state);
    return ESP_OK;
}

static esp_err_t publish_gpio_state(const helix_service_invocation_t *invocation)
{
    cJSON *payload = cJSON_CreateObject();
    cJSON *pins = cJSON_CreateArray();
    if (payload == NULL || pins == NULL) {
        cJSON_Delete(payload);
        cJSON_Delete(pins);
        return ESP_ERR_NO_MEM;
    }

    for (int pin = 0; pin <= 39; pin++) {
        if (!is_safe_gpio(pin)) {
            continue;
        }
        esp_err_t err = add_gpio_pin_state(pins, pin);
        if (err != ESP_OK) {
            cJSON_Delete(payload);
            cJSON_Delete(pins);
            return err;
        }
    }
    cJSON_AddItemToObject(payload, "pins", pins);
    return service_dispatcher_respond(invocation, GPIO_CONTROL_STATE_MESSAGE, payload);
}

static esp_err_t publish_single_gpio_state(const helix_service_invocation_t *invocation, int pin)
{
    if (!is_safe_gpio(pin)) {
        return service_dispatcher_fail(invocation, "GPIO pin is out of supported range");
    }

    cJSON *payload = cJSON_CreateObject();
    cJSON *pins = cJSON_CreateArray();
    if (payload == NULL || pins == NULL) {
        cJSON_Delete(payload);
        cJSON_Delete(pins);
        return ESP_ERR_NO_MEM;
    }

    esp_err_t err = add_gpio_pin_state(pins, pin);
    if (err != ESP_OK) {
        cJSON_Delete(payload);
        cJSON_Delete(pins);
        return err;
    }
    cJSON_AddItemToObject(payload, "pins", pins);
    return service_dispatcher_respond(invocation, GPIO_CONTROL_STATE_MESSAGE, payload);
}

static void update_status_display_for_gpio(int pin, bool high)
{
    char text[32];
    snprintf(text, sizeof(text), "GPIO %d %s", pin, high ? "HIGH" : "LOW");

    cJSON *payload = cJSON_CreateObject();
    if (payload == NULL) {
        return;
    }
    cJSON_AddStringToObject(payload, "text", text);
    esp_err_t err = service_dispatcher_call(
        STATUS_DISPLAY_SERVICE,
        STATUS_DISPLAY_SET_TEXT_METHOD,
        payload
    );
    cJSON_Delete(payload);

    if (err == ESP_ERR_NOT_FOUND || err == ESP_ERR_INVALID_STATE) {
        ESP_LOGD(TAG, "status display unavailable for gpio status update");
    } else if (err != ESP_OK) {
        ESP_LOGW(TAG, "status display update failed: %s", esp_err_to_name(err));
    }
}

static esp_err_t handle_set_gpio(
    const helix_service_invocation_t *invocation,
    const cJSON *payload
)
{
    gpio_control_set_gpio_request_t request;
    esp_err_t err = gpio_control_parse_set_gpio_request(payload, &request);
    if (err != ESP_OK) {
        return service_dispatcher_fail(invocation, "invalid set-gpio request");
    }
    if (!is_safe_gpio(request.pin)) {
        return service_dispatcher_fail(invocation, "GPIO pin is out of supported range");
    }

    gpio_config_t config = {
        .pin_bit_mask = 1ULL << request.pin,
        .mode = GPIO_MODE_INPUT_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    err = gpio_config(&config);
    if (err != ESP_OK) {
        return service_dispatcher_fail(invocation, esp_err_to_name(err));
    }

    gpio_set_level((gpio_num_t)request.pin, request.high ? 1 : 0);
    ESP_LOGI(TAG, "set gpio pin=%d high=%d", request.pin, request.high);
    update_status_display_for_gpio(request.pin, request.high);
    return publish_single_gpio_state(invocation, request.pin);
}

static esp_err_t handle_read_gpio(
    const helix_service_invocation_t *invocation,
    const cJSON *payload
)
{
    const cJSON *pin_json = payload != NULL ? cJSON_GetObjectItemCaseSensitive(payload, "pin") : NULL;
    if (pin_json != NULL) {
        if (!cJSON_IsNumber(pin_json)) {
            return service_dispatcher_fail(invocation, "pin must be a number");
        }
        return publish_single_gpio_state(invocation, pin_json->valueint);
    }
    return publish_gpio_state(invocation);
}

static esp_err_t gpio_control_handle_command(
    const helix_service_invocation_t *invocation,
    const char *method,
    const cJSON *payload
)
{
    if (strcmp(method, GPIO_CONTROL_SET_GPIO_METHOD) == 0) {
        return handle_set_gpio(invocation, payload);
    }
    if (strcmp(method, GPIO_CONTROL_READ_GPIO_METHOD) == 0) {
        return handle_read_gpio(invocation, payload);
    }
    return service_dispatcher_fail(invocation, "unsupported gpio-control command");
}

esp_err_t gpio_control_start(void)
{
    ESP_LOGI(TAG, "starting GPIO control service");
    return service_dispatcher_register(GPIO_CONTROL_SERVICE, gpio_control_handle_command);
}
