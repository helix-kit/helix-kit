#pragma once

#include <stdbool.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Mount the FAT filesystem on the `storage` partition at CONFIG_HELIX_STORAGE_MOUNT_POINT (idempotent); ESP_ERR_NOT_FOUND with a warning (no abort) if the partition is missing.
esp_err_t helix_storage_mount(void);

// Absolute mount point (e.g. "/storage"), or NULL if storage is not mounted.
const char *helix_storage_mount_point(void);

// True once helix_storage_mount() has successfully mounted the filesystem.
bool helix_storage_is_mounted(void);

#ifdef __cplusplus
}
#endif
