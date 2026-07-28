#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Destination a file-transfer session writes into; the service is sink-agnostic (begin -> write* -> commit/abort). Backends: fs:<path> (helix_fs_sink), planned ota:next. Bytes arrive at explicit offsets so a future resume path needs no interface change.

typedef struct helix_xfer_sink helix_xfer_sink_t;

struct helix_xfer_sink {
    // Persist `len` bytes at `offset`. Called repeatedly as chunks arrive.
    esp_err_t (*write)(helix_xfer_sink_t *self, uint32_t offset, const uint8_t *data, size_t len);
    // Finalise the destination (close file / set boot partition); the sink is then spent.
    esp_err_t (*commit)(helix_xfer_sink_t *self);
    // Discard any partial state (delete file / cancel OTA). Best-effort.
    void (*abort)(helix_xfer_sink_t *self);
    // Free the sink and all resources. Always the last call.
    void (*destroy)(helix_xfer_sink_t *self);
};

// Open a sink for `dest` (scheme-prefixed, e.g. "fs:uploads/a.bin"); NULL on failure, setting *err_out.
helix_xfer_sink_t *helix_xfer_sink_open(const char *dest, size_t total_size, esp_err_t *err_out);

#ifdef __cplusplus
}
#endif
