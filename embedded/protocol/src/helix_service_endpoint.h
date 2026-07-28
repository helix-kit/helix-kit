#pragma once

#include "esp_err.h"
#include "helix_protocol.h"
#include "helix_transport.h"

esp_err_t helix_service_endpoint_init(void);
esp_err_t helix_service_endpoint_attach_transport(const helix_transport_t *transport);

// The first attached transport whose binary side-channel can carry bulk bytes, or NULL if none can.
const helix_transport_t *helix_service_endpoint_binary_transport(void);
esp_err_t helix_service_endpoint_receive(
    const helix_protocol_packet_t *packet,
    const helix_transport_t *source,
    void *user_data
);
