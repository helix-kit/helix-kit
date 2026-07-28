#include "helix_ui_esp32.h"

#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "helix_binary_channel.h"
#include "helix_service_endpoint.h"
#include "helix_ui.h"
#include "helix_ui_display_stream.h"
#include "helix_ui_service.h"
#include "sdkconfig.h"

static const char *TAG = "helix_ui_esp32";

static uint32_t now_ms(void)
{
    return (uint32_t)(esp_timer_get_time() / 1000);
}

// Display frames leave on the binary side-channel; before a transport attaches there's
// nowhere to send pixels, and LVGL invalidation redraws them once the host calls `ui.refresh`.
static esp_err_t stream_write(
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len,
    void *context
)
{
    (void)context;
    const helix_transport_t *transport = helix_service_endpoint_binary_transport();
    if (transport == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    return helix_binary_channel_send(transport, session, offset, data, len);
}

static void ui_task(void *argument)
{
    (void)argument;
    for (;;) {
        uint32_t idle_ms = helix_ui_run();
        if (idle_ms < CONFIG_HELIX_UI_MIN_IDLE_MS) {
            idle_ms = CONFIG_HELIX_UI_MIN_IDLE_MS;
        }
        vTaskDelay(pdMS_TO_TICKS(idle_ms));
    }
}

esp_err_t helix_ui_esp32_start(helix_ui_screen_fn screen)
{
    if (screen == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    const helix_ui_stream_config_t stream_config = {
        .width = CONFIG_HELIX_UI_WIDTH,
        .height = CONFIG_HELIX_UI_HEIGHT,
        .max_chunk = CONFIG_HELIX_UI_STREAM_CHUNK_BYTES,
        .write = stream_write,
    };
    const helix_ui_display_t *display = helix_ui_display_stream(&stream_config);
    if (display == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    const helix_ui_config_t config = {
        .display = display,
        .screen = screen,
        .now_ms = now_ms,
        .draw_buffer_lines = CONFIG_HELIX_UI_DRAW_BUFFER_LINES,
    };
    esp_err_t err = helix_ui_start(&config);
    if (err != ESP_OK) {
        return err;
    }

    err = helix_ui_service_register();
    if (err != ESP_OK) {
        return err;
    }

    BaseType_t created = xTaskCreate(
        ui_task,
        "helix_ui",
        CONFIG_HELIX_UI_TASK_STACK_BYTES,
        NULL,
        CONFIG_HELIX_UI_TASK_PRIORITY,
        NULL
    );
    if (created != pdPASS) {
        return ESP_ERR_NO_MEM;
    }

    ESP_LOGI(TAG, "ui task started %dx%d", CONFIG_HELIX_UI_WIDTH, CONFIG_HELIX_UI_HEIGHT);
    return ESP_OK;
}
