#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "driver/spi_master.h"
#include "esp_err.h"

// nRF24L01(+) radio on SPI. Register/command access only: roles (PTX/PRX) and
// framing are the caller's business, so this stays usable for a bring-up probe,
// a link test, or a future Helix transport alike.

#define HELIX_NRF24_CMD_R_REGISTER 0x00
#define HELIX_NRF24_CMD_W_REGISTER 0x20
#define HELIX_NRF24_CMD_R_RX_PAYLOAD 0x61
#define HELIX_NRF24_CMD_W_TX_PAYLOAD 0xA0
#define HELIX_NRF24_CMD_FLUSH_TX 0xE1
#define HELIX_NRF24_CMD_FLUSH_RX 0xE2
#define HELIX_NRF24_CMD_NOP 0xFF

#define HELIX_NRF24_REG_CONFIG 0x00
#define HELIX_NRF24_REG_EN_AA 0x01
#define HELIX_NRF24_REG_EN_RXADDR 0x02
#define HELIX_NRF24_REG_SETUP_AW 0x03
#define HELIX_NRF24_REG_SETUP_RETR 0x04
#define HELIX_NRF24_REG_RF_CH 0x05
#define HELIX_NRF24_REG_RF_SETUP 0x06
#define HELIX_NRF24_REG_STATUS 0x07
#define HELIX_NRF24_REG_OBSERVE_TX 0x08
#define HELIX_NRF24_REG_RX_ADDR_P0 0x0A
#define HELIX_NRF24_REG_TX_ADDR 0x10
#define HELIX_NRF24_REG_RX_PW_P0 0x11
#define HELIX_NRF24_REG_FIFO_STATUS 0x17
#define HELIX_NRF24_REG_DYNPD 0x1C
#define HELIX_NRF24_REG_FEATURE 0x1D

#define HELIX_NRF24_STATUS_MAX_RT 0x10
#define HELIX_NRF24_STATUS_TX_DS 0x20
#define HELIX_NRF24_STATUS_RX_DR 0x40
#define HELIX_NRF24_STATUS_IRQ_MASK 0x70

#define HELIX_NRF24_CONFIG_PRIM_RX 0x01
#define HELIX_NRF24_CONFIG_PWR_UP 0x02
#define HELIX_NRF24_CONFIG_EN_CRC 0x08

#define HELIX_NRF24_RF_SETUP_RF_DR_LOW 0x20
#define HELIX_NRF24_RF_SETUP_RF_DR_HIGH 0x08

#define HELIX_NRF24_ADDR_WIDTH 5
#define HELIX_NRF24_MAX_PAYLOAD 32

// Breadboard wiring shared by every nRF24 app on this board.
#define HELIX_NRF24_DEFAULT_PIN_MOSI 23
#define HELIX_NRF24_DEFAULT_PIN_MISO 19
#define HELIX_NRF24_DEFAULT_PIN_SCK 18
#define HELIX_NRF24_DEFAULT_PIN_CSN 5
#define HELIX_NRF24_DEFAULT_PIN_CE 4
#define HELIX_NRF24_DEFAULT_PIN_IRQ 27

typedef struct {
    spi_host_device_t host;
    int pin_mosi;
    int pin_miso;
    int pin_sck;
    int pin_csn;
    int pin_ce;
    int pin_irq;
    int clock_hz;
} helix_nrf24_config_t;

typedef struct {
    spi_device_handle_t spi;
    int pin_ce;
    int pin_irq;
    spi_host_device_t host;
} helix_nrf24_t;

#define HELIX_NRF24_DEFAULT_CONFIG()                                                               \
    (helix_nrf24_config_t)                                                                         \
    {                                                                                              \
        .host = SPI2_HOST, .pin_mosi = HELIX_NRF24_DEFAULT_PIN_MOSI,                               \
        .pin_miso = HELIX_NRF24_DEFAULT_PIN_MISO, .pin_sck = HELIX_NRF24_DEFAULT_PIN_SCK,          \
        .pin_csn = HELIX_NRF24_DEFAULT_PIN_CSN, .pin_ce = HELIX_NRF24_DEFAULT_PIN_CE,              \
        .pin_irq = HELIX_NRF24_DEFAULT_PIN_IRQ, .clock_hz = 4 * 1000 * 1000,                       \
    }

esp_err_t helix_nrf24_init(const helix_nrf24_config_t *config, helix_nrf24_t *radio);
esp_err_t helix_nrf24_deinit(helix_nrf24_t *radio);

esp_err_t helix_nrf24_xfer(helix_nrf24_t *radio, const uint8_t *tx, uint8_t *rx, size_t len);
esp_err_t helix_nrf24_read_regs(helix_nrf24_t *radio, uint8_t reg, uint8_t *out, size_t len);
esp_err_t helix_nrf24_read_reg(helix_nrf24_t *radio, uint8_t reg, uint8_t *out);
esp_err_t helix_nrf24_write_regs(helix_nrf24_t *radio, uint8_t reg, const uint8_t *value,
                                 size_t len);
esp_err_t helix_nrf24_write_reg(helix_nrf24_t *radio, uint8_t reg, uint8_t value);
esp_err_t helix_nrf24_command(helix_nrf24_t *radio, uint8_t cmd);
esp_err_t helix_nrf24_status(helix_nrf24_t *radio, uint8_t *out);

void helix_nrf24_set_ce(helix_nrf24_t *radio, int level);
int helix_nrf24_irq_level(helix_nrf24_t *radio);
void helix_nrf24_clear_interrupts(helix_nrf24_t *radio);

// An MCU reset does not power-cycle the radio, so a previous run's writes are
// still latched; restore the datasheet values before probing them.
void helix_nrf24_restore_power_on_defaults(helix_nrf24_t *radio);
