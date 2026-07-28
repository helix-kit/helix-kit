#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "helix_protocol.h"

typedef struct helix_transport helix_transport_t;

typedef esp_err_t (*helix_transport_send_packet_json_t)(
    const char *json,
    void *context
);

// Emit one binary chunk on the transport's data side-channel; NULL for JSON-only transports.
typedef esp_err_t (*helix_transport_send_binary_t)(
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len,
    void *context
);

struct helix_transport {
    const char *name;
    helix_transport_send_packet_json_t send_packet_json;
    helix_transport_send_binary_t send_binary;
    void *context;
};

typedef esp_err_t (*helix_transport_packet_handler_t)(
    const helix_protocol_packet_t *packet,
    const helix_transport_t *source,
    void *user_data
);
