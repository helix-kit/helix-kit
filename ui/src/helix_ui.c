#include "helix_ui.h"

#include <stdlib.h>

#include "esp_log.h"
#include "lvgl.h"

static const char *TAG = "helix_ui";

static const helix_ui_display_t *s_display;
static lv_display_t *s_lv_display;
static lv_indev_t *s_lv_indev;
static uint8_t *s_draw_buffer;
static bool s_ready;

static void flush_cb(lv_display_t *display, const lv_area_t *area, uint8_t *pixels)
{
    const uint32_t width = (uint32_t)lv_area_get_width(area);
    const uint32_t height = (uint32_t)lv_area_get_height(area);
    const size_t len = (size_t)width * height * 2;

    esp_err_t err = s_display->flush(
        s_display,
        (uint16_t)area->x1,
        (uint16_t)area->y1,
        (uint16_t)area->x2,
        (uint16_t)area->y2,
        pixels,
        len
    );
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "flush failed: %s", esp_err_to_name(err));
    }
    lv_display_flush_ready(display);
}

// LVGL polls this; we hand it one queued event per call and ask to be polled
// again while more are pending, so a press and its release are never coalesced
// into a single frame (which would swallow the click).
static void indev_read_cb(lv_indev_t *indev, lv_indev_data_t *data)
{
    (void)indev;
    static helix_ui_pointer_t last;

    helix_ui_pointer_t event;
    if (helix_ui_input_pop_pointer(&event)) {
        last = event;
    }
    data->point.x = last.x;
    data->point.y = last.y;
    data->state = last.pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
    data->continue_reading = helix_ui_input_pending();
}

esp_err_t helix_ui_start(const helix_ui_config_t *config)
{
    if (config == NULL || config->display == NULL || config->screen == NULL ||
        config->now_ms == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (config->display->flush == NULL || config->display->width == 0 ||
        config->display->height == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_ready) {
        return ESP_OK;
    }

    s_display = config->display;
    if (s_display->init != NULL) {
        esp_err_t err = s_display->init(s_display);
        if (err != ESP_OK) {
            return err;
        }
    }

    const uint16_t lines = config->draw_buffer_lines > 0
        ? config->draw_buffer_lines
        : HELIX_UI_DEFAULT_DRAW_LINES;
    const size_t buffer_bytes = (size_t)s_display->width * lines * 2;
    s_draw_buffer = malloc(buffer_bytes);
    if (s_draw_buffer == NULL) {
        return ESP_ERR_NO_MEM;
    }

    lv_init();
    lv_tick_set_cb(config->now_ms);

    s_lv_display = lv_display_create(s_display->width, s_display->height);
    if (s_lv_display == NULL) {
        free(s_draw_buffer);
        s_draw_buffer = NULL;
        return ESP_ERR_NO_MEM;
    }
    lv_display_set_color_format(s_lv_display, LV_COLOR_FORMAT_RGB565);
    lv_display_set_flush_cb(s_lv_display, flush_cb);
    lv_display_set_buffers(
        s_lv_display,
        s_draw_buffer,
        NULL,
        buffer_bytes,
        LV_DISPLAY_RENDER_MODE_PARTIAL
    );

    s_lv_indev = lv_indev_create();
    if (s_lv_indev == NULL) {
        free(s_draw_buffer);
        s_draw_buffer = NULL;
        return ESP_ERR_NO_MEM;
    }
    lv_indev_set_type(s_lv_indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(s_lv_indev, indev_read_cb);
    lv_indev_set_display(s_lv_indev, s_lv_display);

    config->screen();
    s_ready = true;
    ESP_LOGI(
        TAG,
        "ui started display=%s %ux%u draw_lines=%u",
        s_display->name != NULL ? s_display->name : "?",
        s_display->width,
        s_display->height,
        lines
    );
    return ESP_OK;
}

uint32_t helix_ui_run(void)
{
    if (!s_ready) {
        return 100;
    }
    return lv_timer_handler();
}

esp_err_t helix_ui_refresh(void)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    lv_obj_invalidate(lv_screen_active());
    return ESP_OK;
}

void helix_ui_size(uint16_t *width, uint16_t *height)
{
    if (width != NULL) {
        *width = s_display != NULL ? s_display->width : 0;
    }
    if (height != NULL) {
        *height = s_display != NULL ? s_display->height : 0;
    }
}

bool helix_ui_ready(void)
{
    return s_ready;
}
