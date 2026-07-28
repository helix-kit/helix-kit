#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

// The display seam: an LVGL screen rendered through whichever driver the device provides
// (streaming, SPI panel, framebuffer). Drivers own only pixel delivery.
// Pixels are RGB565 LE, row-major within the flushed rectangle; bounds are inclusive.

typedef struct helix_ui_display helix_ui_display_t;

struct helix_ui_display {
    const char *name;
    uint16_t width;
    uint16_t height;
    esp_err_t (*init)(const helix_ui_display_t *self);
    esp_err_t (*flush)(
        const helix_ui_display_t *self,
        uint16_t x1,
        uint16_t y1,
        uint16_t x2,
        uint16_t y2,
        const uint8_t *pixels,
        size_t len
    );
    void *context;
};
