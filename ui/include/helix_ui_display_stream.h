#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "helix_ui_display.h"

// A display driver that ships flushed rectangles to a host instead of to a
// panel. Each rectangle becomes one logical stream on the binary side-channel:
// `session` is a rolling frame id, `offset` the byte offset within that frame,
// and the bytes are an 8-byte header followed by RGB565 little-endian pixels.
//
//   header: x1(2 LE) y1(2 LE) x2(2 LE) y2(2 LE)   -- inclusive bounds
//   pixels: (x2-x1+1) * (y2-y1+1) * 2 bytes, row-major
//
// The write callback carries the bytes onward (on ESP32: helix_binary_channel).
// It is the same mechanism as a real panel driver, with a wire in place of a
// bus, which is what makes a headless QEMU device displayable at all.

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
