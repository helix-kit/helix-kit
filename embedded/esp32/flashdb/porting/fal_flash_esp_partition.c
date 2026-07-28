/*
 * FAL flash device port backing FlashDB with an ESP-IDF partition.
 *
 * Maps the FAL `norflash0` device onto the `flashdb` esp_partition (custom
 * type 0x40, subtype 0x00 — see partitions_8mb.csv). Adapted from the upstream
 * FlashDB esp32 demo port (kaans, Apache-2.0).
 * SPDX-License-Identifier: Apache-2.0
 */
#include <inttypes.h>
#include <string.h>

#include "esp_log.h"
#include "esp_partition.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include <fal.h>
#include <fal_cfg.h>

#define FLASH_ERASE_MIN_SIZE (4 * 1024)

static const char *TAG = "fal_esp_partition";
static SemaphoreHandle_t s_lock;
static const esp_partition_t *s_partition;

#define LOCK()   do { xSemaphoreTake(s_lock, portMAX_DELAY); } while (0)
#define UNLOCK() do { xSemaphoreGive(s_lock); } while (0)

static int init(void)
{
    if (s_lock == NULL) {
        s_lock = xSemaphoreCreateCounting(1, 1);
        assert(s_lock != NULL);
    }
    // Must match the `flashdb` entry (type 0x40, subtype 0x00) in the CSV.
    s_partition = esp_partition_find_first((esp_partition_type_t)0x40,
                                           (esp_partition_subtype_t)0x00, "flashdb");
    if (s_partition == NULL) {
        ESP_LOGE(TAG, "no 'flashdb' partition found");
        return -1;
    }
    if (s_partition->size != HELIX_FLASHDB_PART_LEN) {
        ESP_LOGW(TAG, "flashdb partition size 0x%" PRIx32 " != configured 0x%x",
                 s_partition->size, (unsigned)HELIX_FLASHDB_PART_LEN);
    }
    return 1;
}

static int read(long offset, uint8_t *buf, size_t size)
{
    LOCK();
    esp_err_t ret = esp_partition_read(s_partition, offset, buf, size);
    UNLOCK();
    return ret == ESP_OK ? (int)size : -1;
}

static int write(long offset, const uint8_t *buf, size_t size)
{
    LOCK();
    esp_err_t ret = esp_partition_write(s_partition, offset, buf, size);
    UNLOCK();
    return ret == ESP_OK ? (int)size : -1;
}

static int erase(long offset, size_t size)
{
    int32_t erase_size = ((size - 1) / FLASH_ERASE_MIN_SIZE) + 1;
    LOCK();
    esp_err_t ret = esp_partition_erase_range(s_partition, offset, erase_size * FLASH_ERASE_MIN_SIZE);
    UNLOCK();
    return ret == ESP_OK ? (int)size : -1;
}

const struct fal_flash_dev nor_flash0 = {
    .name = NOR_FLASH_DEV_NAME,
    .addr = 0x0,                       // relative to the partition start
    .len = HELIX_FLASHDB_PART_LEN,
    .blk_size = FLASH_ERASE_MIN_SIZE,  // 4 KB sector
    .ops = {init, read, write, erase},
    .write_gran = 1,                   // 1-byte writes (NOR)
};
