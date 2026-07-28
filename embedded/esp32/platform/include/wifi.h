#pragma once

#include "esp_err.h"

#define HELIX_WIFI_SSID_MAX_BYTES 33
#define HELIX_WIFI_PASSWORD_MAX_BYTES 65

typedef struct {
    char ssid[HELIX_WIFI_SSID_MAX_BYTES];
    char password[HELIX_WIFI_PASSWORD_MAX_BYTES];
} helix_wifi_config_t;

esp_err_t wifi_config_load(helix_wifi_config_t *config);
esp_err_t wifi_register_provisioning_domain(void);
esp_err_t wifi_connect(const helix_wifi_config_t *config);
esp_err_t wifi_validate_credentials(const helix_wifi_config_t *candidate, const helix_wifi_config_t *restore);
