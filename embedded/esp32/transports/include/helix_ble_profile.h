#pragma once

#include <stddef.h>

#include "esp_err.h"
#include "helix_transport.h"
#include "host/ble_gap.h"
#include "host/ble_gatt.h"

#define HELIX_BLE_DEFAULT_COMMAND_MAX_BYTES 768
#define HELIX_BLE_DEFAULT_NOTIFY_MAX_BYTES 480
#define HELIX_BLE_SERVICE_UUID "8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0001"

typedef struct {
    const char *info_json;
    size_t max_command_bytes;
    size_t max_notify_bytes;
    helix_transport_packet_handler_t on_packet;
    void *user_data;
} helix_ble_profile_config_t;

esp_err_t helix_ble_profile_init(const helix_ble_profile_config_t *config);
const struct ble_gatt_svc_def *helix_ble_profile_service_definition(void);
int helix_ble_profile_handle_gap_event(struct ble_gap_event *event);
esp_err_t helix_ble_profile_notify_packet_json(const char *json);
const helix_transport_t *helix_ble_profile_transport(void);
