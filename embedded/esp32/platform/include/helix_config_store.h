#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "cJSON.h"
#include "esp_err.h"

#define HELIX_CONFIG_NAMESPACE "helix_config"
#define HELIX_CONFIG_KEY_MAX_BYTES 64
#define HELIX_CONFIG_VALUE_MAX_BYTES 192

esp_err_t helix_config_get_string(
    const char *domain,
    const char *key,
    char *out,
    size_t out_len
);
esp_err_t helix_config_set_string(const char *domain, const char *key, const char *value);
esp_err_t helix_config_erase_domain(const char *domain);
esp_err_t helix_config_get_required_string(
    const char *domain,
    const char *key,
    char *out,
    size_t out_len,
    const char *log_tag
);
esp_err_t helix_config_get_optional_string(const char *domain, const char *key, char *out, size_t out_len);
bool helix_config_overlay_string(char *out, size_t out_len, const cJSON *values, const char *key);
bool helix_config_parse_u16(const char *value, uint16_t *out);
esp_err_t helix_config_overlay_u16(uint16_t *out, const cJSON *values, const char *key);
