// SPDX-License-Identifier: AGPL-3.0-only
// Helix AVR compat shim: a minimal stand-in for ESP-IDF's <esp_err.h> so the
// shared Helix protocol core (helix_protocol.c, helix_service_dispatcher.c,
// helix_service_endpoint.c) compiles unchanged on AVR. Values match ESP-IDF.
#pragma once

#include <stddef.h>

typedef int esp_err_t;

#define ESP_OK 0
#define ESP_FAIL -1

#define ESP_ERR_NO_MEM 0x101
#define ESP_ERR_INVALID_ARG 0x102
#define ESP_ERR_INVALID_STATE 0x103
#define ESP_ERR_INVALID_SIZE 0x104
#define ESP_ERR_NOT_FOUND 0x105
#define ESP_ERR_NOT_SUPPORTED 0x106
#define ESP_ERR_TIMEOUT 0x107

#ifdef __cplusplus
extern "C" {
#endif

static inline const char *esp_err_to_name(esp_err_t code)
{
    switch (code) {
        case ESP_OK: return "ESP_OK";
        case ESP_FAIL: return "ESP_FAIL";
        case ESP_ERR_NO_MEM: return "ESP_ERR_NO_MEM";
        case ESP_ERR_INVALID_ARG: return "ESP_ERR_INVALID_ARG";
        case ESP_ERR_INVALID_STATE: return "ESP_ERR_INVALID_STATE";
        case ESP_ERR_INVALID_SIZE: return "ESP_ERR_INVALID_SIZE";
        case ESP_ERR_NOT_FOUND: return "ESP_ERR_NOT_FOUND";
        case ESP_ERR_NOT_SUPPORTED: return "ESP_ERR_NOT_SUPPORTED";
        case ESP_ERR_TIMEOUT: return "ESP_ERR_TIMEOUT";
        default: return "ESP_ERR";
    }
}

#ifdef __cplusplus
}
#endif
