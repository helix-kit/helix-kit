#pragma once

#include "esp_err.h"

// Over-the-air link test: transmits a numbered payload to a listening peer and reports whether each one was acknowledged (TX_DS) or exhausted its retries (MAX_RT).
esp_err_t nrf24_link_start(void);
