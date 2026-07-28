#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "helix_ui_display.h"
#include "helix_ui_input.h"
#include "helix_ui_screen.h"

// Helix UI core: LVGL wired to a display driver, a pointer input queue, and a
// screen. It owns no task and no clock -- a port (port/esp32, or a Linux port)
// supplies the millisecond clock and calls helix_ui_run() in a loop. That keeps
// the core free of OS dependencies so the same screens run on both.

#define HELIX_UI_DEFAULT_DRAW_LINES 40

typedef struct {
    const helix_ui_display_t *display;
    helix_ui_screen_fn screen;
    uint32_t (*now_ms)(void);
    // Height in pixels of LVGL's partial render buffer. Trades RAM for fewer,
    // larger flushes; 0 selects HELIX_UI_DEFAULT_DRAW_LINES.
    uint16_t draw_buffer_lines;
} helix_ui_config_t;

esp_err_t helix_ui_start(const helix_ui_config_t *config);

// Pump LVGL once. Returns the number of milliseconds the caller should idle
// before pumping again.
uint32_t helix_ui_run(void);

// Invalidate the whole screen so the next pump re-flushes every pixel. The host
// viewer calls this after (re)connecting, when it has no framebuffer yet.
esp_err_t helix_ui_refresh(void);

void helix_ui_size(uint16_t *width, uint16_t *height);

bool helix_ui_ready(void);
