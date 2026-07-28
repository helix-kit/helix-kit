#pragma once

#include <stddef.h>

#include "esp_err.h"
#include "helix_xfer_sink.h"

#ifdef __cplusplus
extern "C" {
#endif

// Open a sink that writes to a FAT file (relative to the storage mount) under the mounted storage filesystem.
helix_xfer_sink_t *helix_fs_sink_open(const char *relpath, size_t total_size, esp_err_t *err_out);

#ifdef __cplusplus
}
#endif
