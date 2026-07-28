#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

// The display seam. A Helix UI screen is written once against LVGL and rendered
// through whichever driver the device provides: a streaming driver that ships
// pixels to a host (QEMU today, a remote viewer tomorrow), an SPI panel on real
// hardware, or a framebuffer on Linux. Drivers own pixel delivery and nothing
// else -- no widgets, no input, no transport knowledge.
//
// Pixels are RGB565, little-endian, row-major within the flushed rectangle;
// bounds are inclusive.

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
