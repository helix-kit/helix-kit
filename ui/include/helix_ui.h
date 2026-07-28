#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "helix_ui_display.h"
#include "helix_ui_input.h"
#include "helix_ui_screen.h"

// Helix UI core: LVGL wired to a display driver, a pointer input queue, and a screen.
// It owns no task or clock -- a port supplies the clock and calls helix_ui_run() in a loop.

#define HELIX_UI_DEFAULT_DRAW_LINES 40

typedef struct {
    const helix_ui_display_t *display;
    helix_ui_screen_fn screen;
    uint32_t (*now_ms)(void);
    // Height in pixels of LVGL's partial render buffer; 0 selects HELIX_UI_DEFAULT_DRAW_LINES.
    uint16_t draw_buffer_lines;
} helix_ui_config_t;

esp_err_t helix_ui_start(const helix_ui_config_t *config);

// Pump LVGL once; returns milliseconds the caller should idle before pumping again.
uint32_t helix_ui_run(void);

// Invalidate the whole screen so the next pump re-flushes every pixel (host viewer calls this on reconnect).
esp_err_t helix_ui_refresh(void);

void helix_ui_size(uint16_t *width, uint16_t *height);

bool helix_ui_ready(void);
