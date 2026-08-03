#pragma once

#include "esp_err.h"

// Bring-up smoke test for an nRF24L01(+) radio on SPI: register defaults, a write/read round-trip that a floating bus cannot fake, and a MAX_RT transmit that exercises CE and the IRQ line.
esp_err_t nrf24_smoke_start(void);
