// SPDX-License-Identifier: AGPL-3.0-only
// Compat shim: ESP-IDF code includes <freertos/FreeRTOS.h>; the Arduino AVR
// FreeRTOS port (feilipu) exposes the same kernel via <Arduino_FreeRTOS.h>.
#pragma once
#include <Arduino_FreeRTOS.h>
