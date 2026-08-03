#include "helix_nrf24.h"

#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_common.h"

esp_err_t helix_nrf24_init(const helix_nrf24_config_t *config, helix_nrf24_t *radio)
{
    if (config == NULL || radio == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    memset(radio, 0, sizeof(*radio));
    radio->pin_ce = config->pin_ce;
    radio->pin_irq = config->pin_irq;
    radio->host = config->host;

    gpio_config_t ce_cfg = {
        .pin_bit_mask = 1ULL << config->pin_ce,
        .mode = GPIO_MODE_OUTPUT,
    };
    esp_err_t err = gpio_config(&ce_cfg);
    if (err != ESP_OK) {
        return err;
    }
    gpio_set_level(config->pin_ce, 0);

    gpio_config_t irq_cfg = {
        .pin_bit_mask = 1ULL << config->pin_irq,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    err = gpio_config(&irq_cfg);
    if (err != ESP_OK) {
        return err;
    }

    spi_bus_config_t bus = {
        .mosi_io_num = config->pin_mosi,
        .miso_io_num = config->pin_miso,
        .sclk_io_num = config->pin_sck,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 64,
    };
    err = spi_bus_initialize(config->host, &bus, SPI_DMA_DISABLED);
    if (err != ESP_OK) {
        return err;
    }

    spi_device_interface_config_t dev = {
        .clock_speed_hz = config->clock_hz,
        .mode = 0,
        .spics_io_num = config->pin_csn,
        .queue_size = 1,
    };
    return spi_bus_add_device(config->host, &dev, &radio->spi);
}

esp_err_t helix_nrf24_deinit(helix_nrf24_t *radio)
{
    if (radio == NULL || radio->spi == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    esp_err_t err = spi_bus_remove_device(radio->spi);
    if (err == ESP_OK) {
        err = spi_bus_free(radio->host);
    }
    radio->spi = NULL;
    return err;
}

esp_err_t helix_nrf24_xfer(helix_nrf24_t *radio, const uint8_t *tx, uint8_t *rx, size_t len)
{
    spi_transaction_t t = {
        .length = len * 8,
        .tx_buffer = tx,
        .rx_buffer = rx,
    };
    return spi_device_polling_transmit(radio->spi, &t);
}

esp_err_t helix_nrf24_read_regs(helix_nrf24_t *radio, uint8_t reg, uint8_t *out, size_t len)
{
    uint8_t tx[1 + HELIX_NRF24_MAX_PAYLOAD] = {HELIX_NRF24_CMD_R_REGISTER | (reg & 0x1F)};
    uint8_t rx[1 + HELIX_NRF24_MAX_PAYLOAD] = {0};
    if (len > HELIX_NRF24_MAX_PAYLOAD) {
        return ESP_ERR_INVALID_SIZE;
    }
    esp_err_t err = helix_nrf24_xfer(radio, tx, rx, len + 1);
    if (err == ESP_OK) {
        memcpy(out, rx + 1, len);
    }
    return err;
}

esp_err_t helix_nrf24_read_reg(helix_nrf24_t *radio, uint8_t reg, uint8_t *out)
{
    return helix_nrf24_read_regs(radio, reg, out, 1);
}

esp_err_t helix_nrf24_write_regs(helix_nrf24_t *radio, uint8_t reg, const uint8_t *value,
                                 size_t len)
{
    uint8_t tx[1 + HELIX_NRF24_MAX_PAYLOAD] = {HELIX_NRF24_CMD_W_REGISTER | (reg & 0x1F)};
    if (len > HELIX_NRF24_MAX_PAYLOAD) {
        return ESP_ERR_INVALID_SIZE;
    }
    memcpy(tx + 1, value, len);
    return helix_nrf24_xfer(radio, tx, NULL, len + 1);
}

esp_err_t helix_nrf24_write_reg(helix_nrf24_t *radio, uint8_t reg, uint8_t value)
{
    return helix_nrf24_write_regs(radio, reg, &value, 1);
}

esp_err_t helix_nrf24_command(helix_nrf24_t *radio, uint8_t cmd)
{
    return helix_nrf24_xfer(radio, &cmd, NULL, 1);
}

esp_err_t helix_nrf24_status(helix_nrf24_t *radio, uint8_t *out)
{
    uint8_t tx = HELIX_NRF24_CMD_NOP;
    return helix_nrf24_xfer(radio, &tx, out, 1);
}

void helix_nrf24_set_ce(helix_nrf24_t *radio, int level)
{
    gpio_set_level(radio->pin_ce, level);
}

int helix_nrf24_irq_level(helix_nrf24_t *radio)
{
    return gpio_get_level(radio->pin_irq);
}

void helix_nrf24_clear_interrupts(helix_nrf24_t *radio)
{
    helix_nrf24_write_reg(radio, HELIX_NRF24_REG_STATUS,
                          HELIX_NRF24_STATUS_RX_DR | HELIX_NRF24_STATUS_TX_DS |
                              HELIX_NRF24_STATUS_MAX_RT);
}

void helix_nrf24_restore_power_on_defaults(helix_nrf24_t *radio)
{
    static const uint8_t addr[HELIX_NRF24_ADDR_WIDTH] = {0xE7, 0xE7, 0xE7, 0xE7, 0xE7};
    helix_nrf24_write_reg(radio, HELIX_NRF24_REG_CONFIG, 0x08);
    helix_nrf24_write_reg(radio, HELIX_NRF24_REG_EN_AA, 0x3F);
    helix_nrf24_write_reg(radio, HELIX_NRF24_REG_EN_RXADDR, 0x03);
    helix_nrf24_write_reg(radio, HELIX_NRF24_REG_SETUP_AW, 0x03);
    helix_nrf24_write_reg(radio, HELIX_NRF24_REG_SETUP_RETR, 0x03);
    helix_nrf24_write_reg(radio, HELIX_NRF24_REG_RF_CH, 0x02);
    helix_nrf24_write_regs(radio, HELIX_NRF24_REG_TX_ADDR, addr, HELIX_NRF24_ADDR_WIDTH);
    helix_nrf24_write_regs(radio, HELIX_NRF24_REG_RX_ADDR_P0, addr, HELIX_NRF24_ADDR_WIDTH);
    helix_nrf24_write_reg(radio, HELIX_NRF24_REG_DYNPD, 0x00);
    helix_nrf24_write_reg(radio, HELIX_NRF24_REG_FEATURE, 0x00);
    helix_nrf24_clear_interrupts(radio);
    helix_nrf24_command(radio, HELIX_NRF24_CMD_FLUSH_TX);
    helix_nrf24_command(radio, HELIX_NRF24_CMD_FLUSH_RX);
}
