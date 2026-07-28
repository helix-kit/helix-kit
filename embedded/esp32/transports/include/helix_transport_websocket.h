#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "helix_transport.h"

#define HELIX_WEBSOCKET_DEFAULT_PORT 80
#define HELIX_WEBSOCKET_DEFAULT_PATH "/helix"
#define HELIX_WEBSOCKET_DEFAULT_FRAME_BYTES 4096

typedef struct {
    uint16_t port;
    const char *path;
    size_t frame_bytes;
    helix_transport_packet_handler_t on_packet;
    void *user_data;
} helix_websocket_transport_config_t;

esp_err_t helix_websocket_transport_start(const helix_websocket_transport_config_t *config);
esp_err_t helix_websocket_transport_send_packet_json(const char *json);
bool helix_websocket_transport_is_started(void);
const helix_transport_t *helix_websocket_transport(void);
