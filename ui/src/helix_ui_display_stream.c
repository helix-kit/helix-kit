#include "helix_ui_display_stream.h"

#include <string.h>

#include "esp_log.h"

static const char *TAG = "helix_ui_stream";

static helix_ui_stream_config_t s_config;
static helix_ui_display_t s_display;
static uint16_t s_frame_id;

static void put_u16(uint8_t *out, uint16_t value)
{
    out[0] = (uint8_t)(value & 0xFF);
    out[1] = (uint8_t)(value >> 8);
}

static esp_err_t stream_flush(
    const helix_ui_display_t *self,
    uint16_t x1,
    uint16_t y1,
    uint16_t x2,
    uint16_t y2,
    const uint8_t *pixels,
    size_t len
)
{
    (void)self;
    const size_t max_chunk = s_config.max_chunk > 0
        ? s_config.max_chunk
        : HELIX_UI_STREAM_DEFAULT_CHUNK;

    uint8_t header[HELIX_UI_STREAM_RECT_HEADER_BYTES];
    put_u16(&header[0], x1);
    put_u16(&header[2], y1);
    put_u16(&header[4], x2);
    put_u16(&header[6], y2);

    const uint16_t session = s_frame_id++;

    // First chunk carries the header plus as many pixels as fit, so a small rectangle leaves on one frame.
    uint8_t first[HELIX_UI_STREAM_RECT_HEADER_BYTES + HELIX_UI_STREAM_DEFAULT_CHUNK];
    const size_t first_capacity = max_chunk > sizeof(first)
        ? sizeof(first) - HELIX_UI_STREAM_RECT_HEADER_BYTES
        : max_chunk - HELIX_UI_STREAM_RECT_HEADER_BYTES;
    const size_t first_pixels = len < first_capacity ? len : first_capacity;

    memcpy(first, header, sizeof(header));
    memcpy(&first[sizeof(header)], pixels, first_pixels);

    esp_err_t err = s_config.write(
        session,
        0,
        first,
        sizeof(header) + first_pixels,
        s_config.context
    );
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "frame %u header write failed: %s", session, esp_err_to_name(err));
        return err;
    }

    size_t sent = first_pixels;
    while (sent < len) {
        const size_t remaining = len - sent;
        const size_t chunk = remaining < max_chunk ? remaining : max_chunk;
        err = s_config.write(
            session,
            (uint32_t)(sizeof(header) + sent),
            &pixels[sent],
            chunk,
            s_config.context
        );
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "frame %u write failed at %u: %s", session, (unsigned)sent,
                     esp_err_to_name(err));
            return err;
        }
        sent += chunk;
    }
    return ESP_OK;
}

const helix_ui_display_t *helix_ui_display_stream(const helix_ui_stream_config_t *config)
{
    if (config == NULL || config->write == NULL || config->width == 0 || config->height == 0) {
        return NULL;
    }
    if (config->max_chunk > 0 && config->max_chunk <= HELIX_UI_STREAM_RECT_HEADER_BYTES) {
        return NULL;
    }
    s_config = *config;
    s_display = (helix_ui_display_t){
        .name = "stream",
        .width = config->width,
        .height = config->height,
        .init = NULL,
        .flush = stream_flush,
        .context = NULL,
    };
    return &s_display;
}
