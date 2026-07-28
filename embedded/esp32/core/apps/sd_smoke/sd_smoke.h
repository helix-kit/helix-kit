#pragma once

#include "esp_err.h"

// Bring-up smoke test for an SD card over SPI, sharing a GPT card with a Radxa board; every block access is clamped to the Helix partition's LBA window so it cannot touch the Radxa OS.
esp_err_t sd_smoke_start(void);
