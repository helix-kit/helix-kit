#pragma once

#include "esp_err.h"

// Bring-up smoke test for an SD card wired over SPI, sharing a GPT-partitioned
// card with a Radxa Linux board. Probes the card, sanity-reads the GPT and the
// Helix partition, then writes and reads back a single file INSIDE the
// dedicated partition only. Every block access is clamped to that partition's
// LBA window, so it cannot touch the Radxa OS partitions.
esp_err_t sd_smoke_start(void);
