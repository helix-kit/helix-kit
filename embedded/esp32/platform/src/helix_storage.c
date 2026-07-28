#include "helix_storage.h"

#include <stdbool.h>

#include "sdkconfig.h"

#include "esp_log.h"

#if CONFIG_HELIX_STORAGE_FAT
#include "esp_vfs_fat.h"
#include "wear_levelling.h"
#endif

static const char *TAG = "helix_storage";

#if CONFIG_HELIX_STORAGE_FAT

static bool s_mounted;
static wl_handle_t s_wl_handle = WL_INVALID_HANDLE;

esp_err_t helix_storage_mount(void)
{
    if (s_mounted) {
        return ESP_OK;
    }

    const esp_vfs_fat_mount_config_t mount_config = {
        .max_files = 4,
        .format_if_mount_failed = true,
        .allocation_unit_size = CONFIG_WL_SECTOR_SIZE,
    };

    esp_err_t err = esp_vfs_fat_spiflash_mount_rw_wl(
        CONFIG_HELIX_STORAGE_MOUNT_POINT,
        CONFIG_HELIX_STORAGE_PARTITION_LABEL,
        &mount_config,
        &s_wl_handle
    );
    if (err == ESP_ERR_NOT_FOUND) {
        ESP_LOGW(TAG, "no '%s' partition; storage disabled",
                 CONFIG_HELIX_STORAGE_PARTITION_LABEL);
        return err;
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "failed to mount FAT storage: %s", esp_err_to_name(err));
        return err;
    }

    s_mounted = true;
    ESP_LOGI(TAG, "mounted FAT storage at %s (partition '%s')",
             CONFIG_HELIX_STORAGE_MOUNT_POINT, CONFIG_HELIX_STORAGE_PARTITION_LABEL);
    return ESP_OK;
}

const char *helix_storage_mount_point(void)
{
    return s_mounted ? CONFIG_HELIX_STORAGE_MOUNT_POINT : NULL;
}

bool helix_storage_is_mounted(void)
{
    return s_mounted;
}

#else /* !CONFIG_HELIX_STORAGE_FAT */

esp_err_t helix_storage_mount(void)
{
    return ESP_OK;
}

const char *helix_storage_mount_point(void)
{
    return NULL;
}

bool helix_storage_is_mounted(void)
{
    return false;
}

#endif /* CONFIG_HELIX_STORAGE_FAT */
