#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

#define HELIX_CLOUD_DEVICE_ID_MAX_BYTES 64
#define HELIX_CLOUD_DEVICE_TOKEN_MAX_BYTES 160
#define HELIX_CLOUD_URL_MAX_BYTES 160
#define HELIX_CLOUD_HOST_MAX_BYTES 96
#define HELIX_CLOUD_TLS_NAME_MAX_BYTES 96
#define HELIX_CLOUD_PROFILE_ID_MAX_BYTES 64

typedef struct mqtt_cert_bundle mqtt_cert_bundle_t;

typedef struct {
    char device_id[HELIX_CLOUD_DEVICE_ID_MAX_BYTES];
    char device_token[HELIX_CLOUD_DEVICE_TOKEN_MAX_BYTES];
    char api_url[HELIX_CLOUD_URL_MAX_BYTES];
    char mqtt_host[HELIX_CLOUD_HOST_MAX_BYTES];
    char mqtt_tls_name[HELIX_CLOUD_TLS_NAME_MAX_BYTES];
    char profile_id[HELIX_CLOUD_PROFILE_ID_MAX_BYTES];
    uint16_t mqtt_port;
} helix_cloud_config_t;

esp_err_t cloud_config_load(helix_cloud_config_t *config);
bool cloud_config_uses_mqtt_tls(const helix_cloud_config_t *config);
esp_err_t cloud_register_provisioning_domain(void);
esp_err_t cloud_start_mqtt(const helix_cloud_config_t *config, mqtt_cert_bundle_t *cert_bundle);
