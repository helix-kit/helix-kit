#pragma once

#include <stdbool.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Mount the FAT filesystem on the `storage` data partition (wear-levelled, on
// SPI flash) at CONFIG_HELIX_STORAGE_MOUNT_POINT. Idempotent. When
// CONFIG_HELIX_STORAGE_FAT is disabled this is a no-op returning ESP_OK.
//
// On a partition table without a matching `storage, data, fat` entry this logs
// a warning and returns ESP_ERR_NOT_FOUND rather than aborting boot.
esp_err_t helix_storage_mount(void);

// Absolute mount point (e.g. "/storage"), or NULL if storage is not mounted.
const char *helix_storage_mount_point(void);

// True once helix_storage_mount() has successfully mounted the filesystem.
bool helix_storage_is_mounted(void);

#ifdef __cplusplus
}
#endif
