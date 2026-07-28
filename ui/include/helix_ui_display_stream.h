#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "helix_ui_display.h"

// Display driver that ships flushed rectangles to a host over the binary side-channel.
// Each rectangle is an 8-byte header then RGB565 LE row-major pixels:
//   header: x1(2 LE) y1(2 LE) x2(2 LE) y2(2 LE)   -- inclusive bounds
//   pixels: (x2-x1+1) * (y2-y1+1) * 2 bytes

#define HELIX_UI_STREAM_RECT_HEADER_BYTES 8
#define HELIX_UI_STREAM_DEFAULT_CHUNK 1024

typedef esp_err_t (*helix_ui_stream_write_fn)(
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len,
    void *context
);

typedef struct {
    uint16_t width;
    uint16_t height;
    // Largest chunk the carrier accepts; 0 selects HELIX_UI_STREAM_DEFAULT_CHUNK.
    size_t max_chunk;
    helix_ui_stream_write_fn write;
    void *context;
} helix_ui_stream_config_t;

const helix_ui_display_t *helix_ui_display_stream(const helix_ui_stream_config_t *config);
