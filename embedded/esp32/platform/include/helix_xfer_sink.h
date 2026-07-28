#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// A transfer sink is the destination a file-transfer session writes into. The
// file-transfer service is sink-agnostic: it drives begin -> write* -> commit
// (or abort) and leaves the storage details to the backend. Backends today:
//   fs:<path>  -> a FAT file under the storage mount (helix_fs_sink)
// Planned:
//   ota:next   -> the next OTA partition via esp_ota_write (helix_ota_sink)
//
// Backends receive bytes at explicit offsets so a future resume/out-of-order
// path needs no interface change; the current service writes strictly in order.

typedef struct helix_xfer_sink helix_xfer_sink_t;

struct helix_xfer_sink {
    // Persist `len` bytes at `offset`. Called repeatedly as chunks arrive.
    esp_err_t (*write)(helix_xfer_sink_t *self, uint32_t offset, const uint8_t *data, size_t len);
    // Finalise the destination (close file / set boot partition). After a
    // successful commit the sink is spent and must be destroyed.
    esp_err_t (*commit)(helix_xfer_sink_t *self);
    // Discard any partial state (delete file / cancel OTA). Best-effort.
    void (*abort)(helix_xfer_sink_t *self);
    // Free the sink and all resources. Always the last call.
    void (*destroy)(helix_xfer_sink_t *self);
};

// Open a sink for `dest` (scheme-prefixed, e.g. "fs:uploads/a.bin"). `total_size`
// is the announced transfer size (0 if unknown). Returns NULL on failure and
// sets *err_out (if non-NULL) to the reason.
helix_xfer_sink_t *helix_xfer_sink_open(const char *dest, size_t total_size, esp_err_t *err_out);

#ifdef __cplusplus
}
#endif
