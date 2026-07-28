#include "helix_ui_screens.h"

#include "lvgl.h"

static uint32_t s_taps;
static lv_obj_t *s_tap_label;

static void on_tap(lv_event_t *event)
{
    (void)event;
    s_taps++;
    lv_label_set_text_fmt(s_tap_label, "Taps: %u", (unsigned)s_taps);
}

void helix_ui_screen_hello(void)
{
    lv_obj_t *screen = lv_screen_active();
    lv_obj_set_style_bg_color(screen, lv_color_hex(0x101418), LV_PART_MAIN);

    lv_obj_t *title = lv_label_create(screen);
    lv_label_set_text(title, "Hello, Helix");
    lv_obj_set_style_text_color(title, lv_color_hex(0xF2F5F7), LV_PART_MAIN);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_20, LV_PART_MAIN);
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 32);

    lv_obj_t *subtitle = lv_label_create(screen);
    lv_label_set_text(subtitle, "LVGL on ESP32");
    lv_obj_set_style_text_color(subtitle, lv_color_hex(0x8A97A3), LV_PART_MAIN);
    lv_obj_align(subtitle, LV_ALIGN_TOP_MID, 0, 62);

    lv_obj_t *button = lv_button_create(screen);
    lv_obj_set_size(button, 140, 48);
    lv_obj_align(button, LV_ALIGN_CENTER, 0, 0);
    lv_obj_add_event_cb(button, on_tap, LV_EVENT_CLICKED, NULL);

    lv_obj_t *button_label = lv_label_create(button);
    lv_label_set_text(button_label, "Tap me");
    lv_obj_center(button_label);

    s_tap_label = lv_label_create(screen);
    lv_label_set_text(s_tap_label, "Taps: 0");
    lv_obj_set_style_text_color(s_tap_label, lv_color_hex(0x8A97A3), LV_PART_MAIN);
    lv_obj_align(s_tap_label, LV_ALIGN_CENTER, 0, 48);
}
