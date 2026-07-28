#pragma once

#include <stddef.h>

#include "esp_err.h"
#include "helix_xfer_sink.h"

#ifdef __cplusplus
extern "C" {
#endif

// Open a sink that writes to a FAT file under the storage mount. `relpath` is
// the path relative to the mount point (a leading '/' is ignored). Requires the
// storage filesystem to be mounted (helix_storage_mount).
helix_xfer_sink_t *helix_fs_sink_open(const char *relpath, size_t total_size, esp_err_t *err_out);

#ifdef __cplusplus
}
#endif
