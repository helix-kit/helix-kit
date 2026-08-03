#include "nrf24_link.h"

#include <string.h>

#include "esp_log.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "helix_nrf24.h"

static const char *TAG = "nrf24_link";

// Must match the peer (tooling/nrf24/receive.py defaults).
#define LINK_CHANNEL 76 // 2476 MHz: above the Wi-Fi 2.4 GHz block this room is full of
#define LINK_RF_SETUP 0x06 // 1 Mbps (better sensitivity than 2 Mbps), 0 dBm
#define LINK_PAYLOAD_WIDTH 8
#define LINK_INTERVAL_MS 1000

static const uint8_t LINK_ADDR[HELIX_NRF24_ADDR_WIDTH] = {'H', 'L', 'X', '0', '1'};

static helix_nrf24_t s_radio;

static void configure_as_ptx(void)
{
    helix_nrf24_restore_power_on_defaults(&s_radio);
    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_RF_CH, LINK_CHANNEL);
    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_RF_SETUP, LINK_RF_SETUP);
    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_EN_AA, 0x01);
    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_EN_RXADDR, 0x01);
    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_SETUP_RETR, 0x1F); // 500 us delay, 15 retries
    helix_nrf24_write_regs(&s_radio, HELIX_NRF24_REG_TX_ADDR, LINK_ADDR, HELIX_NRF24_ADDR_WIDTH);
    // Auto-ack comes back on pipe 0, so it has to carry the same address we transmit to.
    helix_nrf24_write_regs(&s_radio, HELIX_NRF24_REG_RX_ADDR_P0, LINK_ADDR,
                           HELIX_NRF24_ADDR_WIDTH);
    helix_nrf24_write_reg(&s_radio, HELIX_NRF24_REG_CONFIG,
                          HELIX_NRF24_CONFIG_EN_CRC | HELIX_NRF24_CONFIG_PWR_UP);
    vTaskDelay(pdMS_TO_TICKS(5));
}

// Returns true when the peer acknowledged; retransmits is the observed retry count.
static bool send_packet(uint32_t counter, unsigned *retransmits, uint8_t *status_out)
{
    uint8_t payload[LINK_PAYLOAD_WIDTH] = {'H', 'L', 'X', 0};
    payload[3] = (uint8_t)(counter >> 24);
    payload[4] = (uint8_t)(counter >> 16);
    payload[5] = (uint8_t)(counter >> 8);
    payload[6] = (uint8_t)counter;
    payload[7] = (uint8_t)(payload[3] ^ payload[4] ^ payload[5] ^ payload[6]);

    helix_nrf24_clear_interrupts(&s_radio);
    helix_nrf24_command(&s_radio, HELIX_NRF24_CMD_FLUSH_TX);

    uint8_t tx[1 + LINK_PAYLOAD_WIDTH] = {HELIX_NRF24_CMD_W_TX_PAYLOAD};
    memcpy(tx + 1, payload, sizeof(payload));
    helix_nrf24_xfer(&s_radio, tx, NULL, sizeof(tx));

    helix_nrf24_set_ce(&s_radio, 1);
    esp_rom_delay_us(20);
    helix_nrf24_set_ce(&s_radio, 0);

    uint8_t status = 0, observe = 0;
    for (int i = 0; i < 80; i++) {
        esp_rom_delay_us(500);
        helix_nrf24_status(&s_radio, &status);
        if (status & (HELIX_NRF24_STATUS_MAX_RT | HELIX_NRF24_STATUS_TX_DS)) {
            break;
        }
    }
    helix_nrf24_read_reg(&s_radio, HELIX_NRF24_REG_OBSERVE_TX, &observe);
    *retransmits = observe & 0x0F;
    *status_out = status;

    bool acked = (status & HELIX_NRF24_STATUS_TX_DS) != 0;
    helix_nrf24_clear_interrupts(&s_radio);
    if (!acked) {
        // A MAX_RT leaves the packet in the FIFO; drop it so the next send is clean.
        helix_nrf24_command(&s_radio, HELIX_NRF24_CMD_FLUSH_TX);
    }
    return acked;
}

static void nrf24_link_task(void *arg)
{
    (void)arg;

    helix_nrf24_config_t config = HELIX_NRF24_DEFAULT_CONFIG();
    esp_err_t err = helix_nrf24_init(&config, &s_radio);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "radio init failed: %s", esp_err_to_name(err));
        vTaskDelete(NULL);
        return;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    configure_as_ptx();

    uint8_t channel = 0, rf_setup = 0;
    helix_nrf24_read_reg(&s_radio, HELIX_NRF24_REG_RF_CH, &channel);
    helix_nrf24_read_reg(&s_radio, HELIX_NRF24_REG_RF_SETUP, &rf_setup);
    ESP_LOGI(TAG, "PTX on channel %u (%u MHz) RF_SETUP=0x%02X addr=%c%c%c%c%c payload=%d bytes",
             channel, 2400U + channel, rf_setup, LINK_ADDR[0], LINK_ADDR[1], LINK_ADDR[2],
             LINK_ADDR[3], LINK_ADDR[4], LINK_PAYLOAD_WIDTH);

    uint32_t counter = 0, sent = 0, acked = 0;
    while (true) {
        unsigned retransmits = 0;
        uint8_t status = 0;
        bool ok = send_packet(counter, &retransmits, &status);
        sent++;
        acked += ok ? 1 : 0;
        ESP_LOGI(TAG, "seq=%lu %s retransmits=%u STATUS=0x%02X delivered=%lu/%lu",
                 (unsigned long)counter, ok ? "ACK " : "LOST", retransmits, status,
                 (unsigned long)acked, (unsigned long)sent);
        counter++;
        vTaskDelay(pdMS_TO_TICKS(LINK_INTERVAL_MS));
    }
}

esp_err_t nrf24_link_start(void)
{
    BaseType_t created = xTaskCreate(nrf24_link_task, "nrf24_link", 4096, NULL, 5, NULL);
    return created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM;
}
