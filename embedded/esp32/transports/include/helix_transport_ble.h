#pragma once

#include <stddef.h>

#include "esp_err.h"
#include "helix_transport.h"

typedef struct {
    const char *device_id;
    const char *profile_id;
    size_t max_command_bytes;
    size_t max_notify_bytes;
    helix_transport_packet_handler_t on_packet;
    void *user_data;
} helix_ble_transport_config_t;

esp_err_t helix_ble_transport_start(const helix_ble_transport_config_t *config);
esp_err_t helix_ble_transport_notify_packet_json(const char *json);
const helix_transport_t *helix_ble_transport(void);
