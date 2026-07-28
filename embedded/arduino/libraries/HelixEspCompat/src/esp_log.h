// SPDX-License-Identifier: AGPL-3.0-only
// Helix AVR compat shim for ESP-IDF's <esp_log.h>. Logging is compiled out on
// AVR (flash/RAM are scarce and the only sink is the protocol serial line).
#pragma once

#define ESP_LOGE(tag, ...) ((void)0)
#define ESP_LOGW(tag, ...) ((void)0)
#define ESP_LOGI(tag, ...) ((void)0)
#define ESP_LOGD(tag, ...) ((void)0)
#define ESP_LOGV(tag, ...) ((void)0)
