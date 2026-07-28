#pragma once

#include "cloud.h"
#include "esp_err.h"

typedef struct mqtt_cert_bundle {
    char *private_key_pem;
    char *certificate_pem;
    char *root_ca_pem;
} mqtt_cert_bundle_t;

void mqtt_cert_bundle_free(mqtt_cert_bundle_t *bundle);
esp_err_t mqtt_cert_bundle_clear(void);
esp_err_t mqtt_cert_bundle_load_or_enroll(
    const helix_cloud_config_t *config,
    mqtt_cert_bundle_t *bundle
);
