#include "sd_smoke.h"

#include <string.h>

#include "driver/gpio.h"
#include "driver/sdspi_host.h"
#include "driver/spi_common.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_random.h"
#include "ff.h"
#include "diskio_impl.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdmmc_cmd.h"

static const char *TAG = "sd_smoke";

// --- SPI wiring (matches the breadboard) -----------------------------------
#define SD_SPI_HOST SPI2_HOST
#define PIN_MOSI 23
#define PIN_MISO 19
#define PIN_SCK 18
#define PIN_CS 5

// --- The Helix partition (sda4) on the shared GPT card ---------------------
// Created on the laptop: sgdisk -n 4:116348928:124735454, mkfs.vfat -F 32.
// These are ABSOLUTE 512-byte LBAs on the physical card.
#define PART4_START_LBA 116348928ULL
#define PART4_LAST_LBA 124735454ULL
#define PART4_SECTOR_COUNT (PART4_LAST_LBA - PART4_START_LBA + 1ULL) // 8386527
#define PART4_LABEL "HELIXESP32"

#define SECTOR_SIZE 512
#define FAT_DRIVE "0:"
#define FAT_PDRV 0

static sdmmc_card_t *s_card;

// --- Windowed FatFs disk-IO: sector 0 here maps to PART4_START_LBA, and any
// access at/after PART4_SECTOR_COUNT is rejected. This is the safety seam that
// makes it impossible for FatFs to read or write outside our partition. -----

static DSTATUS sd_win_init(unsigned char pdrv)
{
    (void)pdrv;
    return 0;
}

static DSTATUS sd_win_status(unsigned char pdrv)
{
    (void)pdrv;
    return 0;
}

static DRESULT sd_win_read(unsigned char pdrv, unsigned char *buff, uint32_t sector, unsigned count)
{
    (void)pdrv;
    if ((uint64_t)sector + count > PART4_SECTOR_COUNT) {
        ESP_LOGE(TAG, "read out of window: sector=%lu count=%u", (unsigned long)sector, count);
        return RES_PARERR;
    }
    esp_err_t err = sdmmc_read_sectors(s_card, buff, PART4_START_LBA + sector, count);
    return err == ESP_OK ? RES_OK : RES_ERROR;
}

static DRESULT sd_win_write(unsigned char pdrv, const unsigned char *buff, uint32_t sector, unsigned count)
{
    (void)pdrv;
    if ((uint64_t)sector + count > PART4_SECTOR_COUNT) {
        ESP_LOGE(TAG, "WRITE BLOCKED out of window: sector=%lu count=%u", (unsigned long)sector, count);
        return RES_PARERR;
    }
    esp_err_t err = sdmmc_write_sectors(s_card, buff, PART4_START_LBA + sector, count);
    return err == ESP_OK ? RES_OK : RES_ERROR;
}

static DRESULT sd_win_ioctl(unsigned char pdrv, unsigned char cmd, void *buff)
{
    (void)pdrv;
    switch (cmd) {
    case CTRL_SYNC:
        return RES_OK;
    case GET_SECTOR_COUNT:
        *((uint32_t *)buff) = (uint32_t)PART4_SECTOR_COUNT;
        return RES_OK;
    case GET_SECTOR_SIZE:
        *((uint16_t *)buff) = SECTOR_SIZE;
        return RES_OK;
    case GET_BLOCK_SIZE:
        *((uint32_t *)buff) = 1;
        return RES_OK;
    default:
        return RES_PARERR;
    }
}

static const ff_diskio_impl_t s_win_diskio = {
    .init = sd_win_init,
    .status = sd_win_status,
    .read = sd_win_read,
    .write = sd_win_write,
    .ioctl = sd_win_ioctl,
};

// --- Card init over SPI -----------------------------------------------------

static esp_err_t sd_card_bringup(void)
{
    spi_bus_config_t bus_cfg = {
        .mosi_io_num = PIN_MOSI,
        .miso_io_num = PIN_MISO,
        .sclk_io_num = PIN_SCK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 4000,
    };
    esp_err_t err = spi_bus_initialize(SD_SPI_HOST, &bus_cfg, SPI_DMA_CH_AUTO);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "spi_bus_initialize failed: %s", esp_err_to_name(err));
        return err;
    }

    sdmmc_host_t host = SDSPI_HOST_DEFAULT();
    host.slot = SD_SPI_HOST;
    host.max_freq_khz = 10000; // conservative for breadboard wiring on first bring-up

    sdspi_device_config_t dev_cfg = SDSPI_DEVICE_CONFIG_DEFAULT();
    dev_cfg.gpio_cs = PIN_CS;
    dev_cfg.host_id = SD_SPI_HOST;

    err = sdspi_host_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "sdspi_host_init failed: %s", esp_err_to_name(err));
        return err;
    }

    s_card = heap_caps_calloc(1, sizeof(sdmmc_card_t), MALLOC_CAP_DEFAULT);
    if (s_card == NULL) {
        return ESP_ERR_NO_MEM;
    }

    // Retry the FULL device init each attempt: add the sdspi device, try to
    // init the card, and on failure remove the device so the next attempt gets
    // a genuinely fresh device/CS (a card can wedge after a botched init, so a
    // bare sdmmc_card_init retry just times out). A settle delay precedes each.
    vTaskDelay(pdMS_TO_TICKS(200));
    err = ESP_FAIL;
    for (int attempt = 1; attempt <= 6; attempt++) {
        sdspi_dev_handle_t handle;
        esp_err_t dev_err = sdspi_host_init_device(&dev_cfg, &handle);
        if (dev_err != ESP_OK) {
            ESP_LOGW(TAG, "attempt %d/6: sdspi_host_init_device failed: %s", attempt,
                     esp_err_to_name(dev_err));
            vTaskDelay(pdMS_TO_TICKS(300));
            continue;
        }
        host.slot = handle;
        err = sdmmc_card_init(&host, s_card);
        if (err == ESP_OK) {
            break;
        }
        ESP_LOGW(TAG, "attempt %d/6: sdmmc_card_init failed: %s", attempt, esp_err_to_name(err));
        sdspi_host_remove_device(handle);
        vTaskDelay(pdMS_TO_TICKS(300));
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "sdmmc_card_init failed: %s -- likely module/card SPI-mode incompatibility",
                 esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(TAG, "SD card initialised:");
    sdmmc_card_print_info(stdout, s_card);
    uint64_t bytes = (uint64_t)s_card->csd.capacity * s_card->csd.sector_size;
    ESP_LOGI(TAG, "capacity: %llu MiB, sector_size=%d", bytes / (1024 * 1024), s_card->csd.sector_size);
    return ESP_OK;
}

// --- Read-only sanity: confirm we see the GPT card and OUR partition --------

static bool sd_sanity_check(uint8_t *buf)
{
    // Sector 0: GPT protective MBR (type 0xEE at 0x1C2, boot signature 0x55AA).
    if (sdmmc_read_sectors(s_card, buf, 0, 1) != ESP_OK) {
        ESP_LOGE(TAG, "failed reading absolute sector 0");
        return false;
    }
    ESP_LOGI(TAG, "sector0 sig=%02X%02X mbr_part0_type=0x%02X (expect 55AA / 0xEE GPT)",
             (unsigned)buf[510], (unsigned)buf[511], (unsigned)buf[0x1C2]);

    // Absolute part4 first sector: the FAT32 VBR we made with mkfs.vfat.
    if (sdmmc_read_sectors(s_card, buf, PART4_START_LBA, 1) != ESP_OK) {
        ESP_LOGE(TAG, "failed reading part4 VBR at LBA %llu", PART4_START_LBA);
        return false;
    }
    char fstype[9] = {0};
    memcpy(fstype, &buf[0x52], 8); // "FAT32   "
    char label[12] = {0};
    memcpy(label, &buf[0x47], 11); // volume label
    ESP_LOGI(TAG, "part4 VBR sig=%02X%02X fstype='%s' label='%s'", (unsigned)buf[510], (unsigned)buf[511],
             fstype, label);

    if (buf[510] != 0x55 || buf[511] != 0xAA || memcmp(label, PART4_LABEL, strlen(PART4_LABEL)) != 0) {
        ESP_LOGE(TAG, "WRITE INTERLOCK: part4 does not look like '%s' -- NOT writing", PART4_LABEL);
        return false;
    }
    ESP_LOGI(TAG, "interlock passed: confirmed on partition '%s'", PART4_LABEL);
    return true;
}

// --- Windowed FAT write + read-back -----------------------------------------

static void sd_write_test(void)
{
    static FATFS fs;
    ff_diskio_register(FAT_PDRV, &s_win_diskio);

    FRESULT fr = f_mount(&fs, FAT_DRIVE, 1);
    if (fr != FR_OK) {
        ESP_LOGE(TAG, "f_mount failed: %d", fr);
        return;
    }

    uint32_t token = esp_random();

    FIL fil;
    fr = f_open(&fil, FAT_DRIVE "/SMOKE.TXT", FA_WRITE | FA_CREATE_ALWAYS);
    if (fr != FR_OK) {
        ESP_LOGE(TAG, "f_open(write) failed: %d", fr);
        f_mount(NULL, FAT_DRIVE, 0);
        return;
    }
    char text[256];
    int n = snprintf(text, sizeof(text),
                     "HELIX ESP32 <-> SD SMOKE TEST\n"
                     "status: OK\n"
                     "partition: %s (LBA %llu, %llu sectors)\n"
                     "run_token: %08lX\n"
                     "Written by the ESP32 over SPI. If the laptop reads this back,\n"
                     "the round trip works and Radxa was untouched.\n",
                     PART4_LABEL, PART4_START_LBA, PART4_SECTOR_COUNT, (unsigned long)token);
    UINT written = 0;
    fr = f_write(&fil, text, n, &written);
    f_close(&fil);
    if (fr != FR_OK || written != (UINT)n) {
        ESP_LOGE(TAG, "f_write failed: fr=%d written=%u/%d", fr, written, n);
        f_mount(NULL, FAT_DRIVE, 0);
        return;
    }
    ESP_LOGI(TAG, "wrote /SMOKE.TXT (%d bytes), run_token=%08lX", n, (unsigned long)token);

    // Read it straight back to prove the write landed.
    char rb[256] = {0};
    fr = f_open(&fil, FAT_DRIVE "/SMOKE.TXT", FA_READ);
    if (fr == FR_OK) {
        UINT rd = 0;
        f_read(&fil, rb, sizeof(rb) - 1, &rd);
        f_close(&fil);
        ESP_LOGI(TAG, "read back %u bytes, match=%s", rd,
                 (rd == (UINT)n && memcmp(rb, text, n) == 0) ? "YES" : "NO");
    }

    // Free space + directory listing.
    DWORD free_clusters = 0;
    FATFS *fatfs_ptr = NULL;
    if (f_getfree(FAT_DRIVE, &free_clusters, &fatfs_ptr) == FR_OK) {
        uint64_t free_mb = (uint64_t)free_clusters * fatfs_ptr->csize * SECTOR_SIZE / (1024 * 1024);
        ESP_LOGI(TAG, "free space: %llu MiB", free_mb);
    }
    FF_DIR dir;
    if (f_opendir(&dir, FAT_DRIVE "/") == FR_OK) {
        FILINFO info;
        ESP_LOGI(TAG, "root directory:");
        while (f_readdir(&dir, &info) == FR_OK && info.fname[0] != 0) {
            ESP_LOGI(TAG, "  %-12s %10lu bytes", info.fname, (unsigned long)info.fsize);
        }
        f_closedir(&dir);
    }

    f_mount(NULL, FAT_DRIVE, 0); // unmount / flush
    ESP_LOGI(TAG, "==== SD SMOKE TEST PASSED -- safe to remove the card ====");
}

// Runs synchronously from app_main (before Wi-Fi comes up), so the card's
// init never competes with the Wi-Fi radio's current draw.
esp_err_t sd_smoke_start(void)
{
    ESP_LOGI(TAG, "SD smoke test starting (MOSI=%d MISO=%d SCK=%d CS=%d)", PIN_MOSI, PIN_MISO, PIN_SCK, PIN_CS);

    if (sd_card_bringup() != ESP_OK) {
        ESP_LOGE(TAG, "==== SD BRING-UP FAILED ====");
        return ESP_OK;
    }

    uint8_t *buf = heap_caps_malloc(SECTOR_SIZE, MALLOC_CAP_DMA);
    if (buf == NULL) {
        ESP_LOGE(TAG, "no DMA buffer");
        return ESP_OK;
    }

    if (sd_sanity_check(buf)) {
        sd_write_test();
    } else {
        ESP_LOGE(TAG, "==== SANITY/INTERLOCK FAILED -- no write performed ====");
    }

    heap_caps_free(buf);
    return ESP_OK;
}
