#include "nrf24_smoke.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "helix_nrf24.h"

static const char *TAG = "nrf24_smoke";

static helix_nrf24_t s_radio;

// A floating MISO reads back as all-ones or all-zeros; a real chip returns the
// documented power-on defaults, so this is the first honest signal of presence.
static bool check_defaults(void)
{
    static const struct {
        uint8_t reg;
        const char *name;
        uint8_t expected;
    } defaults[] = {
        {HELIX_NRF24_REG_CONFIG, "CONFIG", 0x08},
        {HELIX_NRF24_REG_EN_AA, "EN_AA", 0x3F},
        {HELIX_NRF24_REG_EN_RXADDR, "EN_RXADDR", 0x03},
        {HELIX_NRF24_REG_SETUP_AW, "SETUP_AW", 0x03},
        {HELIX_NRF24_REG_SETUP_RETR, "SETUP_RETR", 0x03},
        {HELIX_NRF24_REG_RF_CH, "RF_CH", 0x02},
    };

    bool ok = true;
    for (size_t i = 0; i < sizeof(defaults) / sizeof(defaults[0]); i++) {
        uint8_t value = 0;
        if (helix_nrf24_read_reg(&s_radio, defaults[i].reg, &value) != ESP_OK) {
            ESP_LOGE(TAG, "SPI read failed for %s", defaults[i].name);
            return false;
        }
        bool match = value == defaults[i].expected;
        ESP_LOGI(TAG, "  %-11s = 0x%02X (expected 0x%02X) %s", defaults[i].name, value,
                 defaults[i].expected, match ? "ok" : "MISMATCH");
        ok = ok && match;
    }

    uint8_t status = 0, rf_setup = 0, fifo = 0;
    helix_nrf24_status(&s_radio, &status);
    helix_nrf24_read_reg(&s_radio, HELIX_NRF24_REG_RF_SETUP, &rf_setup);
    helix_nrf24_read_reg(&s_radio, HELIX_NRF24_REG_FIFO_STATUS, &fifo);
    ESP_LOGI(TAG, "  %-11s = 0x%02X", "STATUS", status);
    ESP_LOGI(TAG, "  %-11s = 0x%02X", "RF_SETUP", rf_setup);
    ESP_LOGI(TAG, "  %-11s = 0x%02X", "FIFO_STATUS", fifo);
    return ok;
}

// The 5-byte TX_ADDR is the strongest presence test: only real latched
// registers can hand back an arbitrary multi-byte pattern.
static bool check_address_roundtrip(void)
{
    static const uint8_t pattern[HELIX_NRF24_ADDR_WIDTH] = {0xA5, 0x5A, 0x0F, 0xF0, 0x3C};
    static const uint8_t restore[HELIX_NRF24_ADDR_WIDTH] = {0xE7, 0xE7, 0xE7, 0xE7, 0xE7};
    uint8_t readback[HELIX_NRF24_ADDR_WIDTH] = {0};

    if (helix_nrf24_write_regs(&s_radio, HELIX_NRF24_REG_TX_ADDR, pattern,
                               HELIX_NRF24_ADDR_WIDTH) != ESP_OK ||
        helix_nrf24_read_regs(&s_radio, HELIX_NRF24_REG_TX_ADDR, readback,
                              HELIX_NRF24_ADDR_WIDTH) != ESP_OK) {
        ESP_LOGE(TAG, "TX_ADDR round-trip transfer failed");
        return false;
    }

    bool ok = memcmp(pattern, readback, HELIX_NRF24_ADDR_WIDTH) == 0;
    ESP_LOGI(TAG, "  TX_ADDR wrote %02X:%02X:%02X:%02X:%02X read %02X:%02X:%02X:%02X:%02X %s",
             pattern[0], pattern[1], pattern[2], pattern[3], pattern[4], readback[0], readback[1],
             readback[2], readback[3], readback[4], ok ? "ok" : "MISMATCH");
    helix_nrf24_write_regs(&s_radio, HELIX_NRF24_REG_TX_ADDR, restore, HELIX_NRF24_ADDR_WIDTH);
    return ok;
}

// The nRF24L01+ keeps RF_DR_LOW set; the older nRF24L01 (and most fakes) drop it.
static void report_variant(void)
{
    uint8_t original = 0;
    if (helix_nrf24_read_reg(&s_radio, HELIX_NRF24_REG_RF_SETUP, &original) != ESP_OK) {
        return;
    }
    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_RF_SETUP,
                          original | HELIX_NRF24_RF_SETUP_RF_DR_LOW);
    uint8_t probed = 0;
    helix_nrf24_read_reg(&s_radio, HELIX_NRF24_REG_RF_SETUP, &probed);
    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_RF_SETUP, original);
    ESP_LOGI(TAG, "  variant: %s (RF_SETUP probe 0x%02X)",
             (probed & HELIX_NRF24_RF_SETUP_RF_DR_LOW) ? "nRF24L01+"
                                                       : "nRF24L01 (non-plus or clone)",
             probed);
}

// Transmit to an address nobody is listening on: after the retry budget the
// radio must raise MAX_RT and pull IRQ low. That covers CE and IRQ, which the
// register tests never touch.
static bool check_max_rt_interrupt(void)
{
    static const uint8_t addr[HELIX_NRF24_ADDR_WIDTH] = {0xE7, 0xE7, 0xE7, 0xE7, 0xE7};
    static const uint8_t payload[4] = {0xDE, 0xAD, 0xBE, 0xEF};

    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_CONFIG,
                          HELIX_NRF24_CONFIG_EN_CRC | HELIX_NRF24_CONFIG_PWR_UP);
    vTaskDelay(pdMS_TO_TICKS(5));
    uint8_t config = 0;
    helix_nrf24_read_reg(&s_radio, HELIX_NRF24_REG_CONFIG, &config);
    ESP_LOGI(TAG, "  CONFIG after PWR_UP = 0x%02X (%s)", config,
             (config & HELIX_NRF24_CONFIG_PWR_UP) ? "powered up" : "STILL POWERED DOWN");

    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_EN_AA, 0x01);
    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_EN_RXADDR, 0x01);
    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_SETUP_RETR, 0x1F); // 500 us delay, 15 retries
    helix_nrf24_write_regs(&s_radio, HELIX_NRF24_REG_TX_ADDR, addr, HELIX_NRF24_ADDR_WIDTH);
    helix_nrf24_write_regs(&s_radio, HELIX_NRF24_REG_RX_ADDR_P0, addr, HELIX_NRF24_ADDR_WIDTH);
    helix_nrf24_command(&s_radio, HELIX_NRF24_CMD_FLUSH_TX);
    helix_nrf24_command(&s_radio, HELIX_NRF24_CMD_FLUSH_RX);
    helix_nrf24_clear_interrupts(&s_radio);

    uint8_t tx[1 + sizeof(payload)] = {HELIX_NRF24_CMD_W_TX_PAYLOAD};
    memcpy(tx + 1, payload, sizeof(payload));
    helix_nrf24_xfer(&s_radio, tx, NULL, sizeof(tx));

    // Splitting "did the payload load" from "did CE start the transmit" is what
    // isolates a dead CE wire from a radio that never powered up.
    uint8_t fifo = 0;
    helix_nrf24_read_reg(&s_radio, HELIX_NRF24_REG_FIFO_STATUS, &fifo);
    ESP_LOGI(TAG, "  FIFO_STATUS after load = 0x%02X (%s)", fifo,
             (fifo & 0x10) ? "TX FIFO EMPTY - payload did not load" : "payload queued");

    helix_nrf24_set_ce(&s_radio, 1);
    esp_rom_delay_us(20);
    helix_nrf24_set_ce(&s_radio, 0);

    // Sample fast enough to see the retransmit counter climb: the whole 15-retry
    // budget at ARD=500us is only ~10 ms, and pdMS_TO_TICKS(2) truncates to zero
    // ticks at the default 100 Hz, which silently makes vTaskDelay a bare yield.
    uint8_t status = 0, observe = 0;
    int irq_level = 1;
    char trace[160];
    size_t used = 0;
    for (int i = 0; i < 60; i++) {
        esp_rom_delay_us(500);
        helix_nrf24_status(&s_radio, &status);
        helix_nrf24_read_reg(&s_radio, HELIX_NRF24_REG_OBSERVE_TX, &observe);
        irq_level = helix_nrf24_irq_level(&s_radio);
        if (i < 16 && used < sizeof(trace) - 12) {
            used += (size_t)snprintf(trace + used, sizeof(trace) - used, "%u/%02X ", observe & 0x0F,
                                     status);
        }
        if (status & (HELIX_NRF24_STATUS_MAX_RT | HELIX_NRF24_STATUS_TX_DS)) {
            break;
        }
    }
    ESP_LOGI(TAG, "  trace arc/status: %s", trace);

    helix_nrf24_read_reg(&s_radio, HELIX_NRF24_REG_FIFO_STATUS, &fifo);
    uint8_t config_after = 0;
    helix_nrf24_read_reg(&s_radio, HELIX_NRF24_REG_CONFIG, &config_after);
    ESP_LOGI(TAG, "  STATUS=0x%02X OBSERVE_TX=0x%02X (retransmits=%u) FIFO_STATUS=0x%02X IRQ=%d",
             status, observe, observe & 0x0F, fifo, irq_level);
    if (config_after != config) {
        ESP_LOGW(TAG,
                 "  CONFIG changed mid-transmit 0x%02X -> 0x%02X: the radio reset itself, "
                 "which points at a supply sag (add a 10uF cap across VCC/GND)",
                 config, config_after);
    }

    bool max_rt = (status & HELIX_NRF24_STATUS_MAX_RT) != 0;
    bool irq_asserted = irq_level == 0;
    if (status & HELIX_NRF24_STATUS_TX_DS) {
        ESP_LOGI(TAG, "  TX_DS set: a peer acknowledged, so the link is live in both directions");
    }
    ESP_LOGI(TAG, "  MAX_RT after retries: %s", max_rt ? "yes (CE pulse took effect)" : "NO");
    ESP_LOGI(TAG, "  IRQ pulled low on GPIO%d: %s", s_radio.pin_irq, irq_asserted ? "yes" : "NO");

    helix_nrf24_clear_interrupts(&s_radio);
    helix_nrf24_command(&s_radio, HELIX_NRF24_CMD_FLUSH_TX);
    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_CONFIG, HELIX_NRF24_CONFIG_EN_CRC);
    return max_rt && irq_asserted;
}

static void nrf24_smoke_task(void *arg)
{
    (void)arg;

    helix_nrf24_config_t config = HELIX_NRF24_DEFAULT_CONFIG();
    ESP_LOGI(TAG, "nRF24L01 bring-up: SCK=%d MOSI=%d MISO=%d CSN=%d CE=%d IRQ=%d", config.pin_sck,
             config.pin_mosi, config.pin_miso, config.pin_csn, config.pin_ce, config.pin_irq);

    esp_err_t err = helix_nrf24_init(&config, &s_radio);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "radio init failed: %s", esp_err_to_name(err));
        vTaskDelete(NULL);
        return;
    }
    vTaskDelay(pdMS_TO_TICKS(100)); // radio power-on settling

    ESP_LOGI(TAG, "[1/4] power-on register defaults");
    helix_nrf24_restore_power_on_defaults(&s_radio);
    bool defaults_ok = check_defaults();

    ESP_LOGI(TAG, "[2/4] TX_ADDR write/read round-trip");
    bool roundtrip_ok = check_address_roundtrip();

    ESP_LOGI(TAG, "[3/4] variant probe");
    report_variant();

    ESP_LOGI(TAG, "[4/4] CE pulse and IRQ line (MAX_RT)");
    bool irq_ok = check_max_rt_interrupt();

    if (defaults_ok && roundtrip_ok && irq_ok) {
        ESP_LOGI(TAG, "RESULT: PASS - radio present and every wire in the harness works");
    } else if (roundtrip_ok) {
        ESP_LOGW(TAG, "RESULT: PARTIAL - SPI talks to the radio, but %s%s",
                 defaults_ok ? "" : "registers are not at power-on defaults; ",
                 irq_ok ? "" : "CE/IRQ did not behave as expected");
    } else {
        ESP_LOGE(TAG, "RESULT: FAIL - no register response; check VCC/GND, CSN, SCK, MOSI, MISO");
    }

    vTaskDelete(NULL);
}

esp_err_t nrf24_smoke_start(void)
{
    BaseType_t created = xTaskCreate(nrf24_smoke_task, "nrf24_smoke", 4096, NULL, 5, NULL);
    return created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM;
}
