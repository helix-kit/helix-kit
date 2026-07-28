#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "helix_transport.h"

#ifdef __cplusplus
extern "C" {
#endif

// Transport-agnostic bidirectional binary side-channel: bulk payload bytes travel out-of-band as raw frames (avoiding base64 inflation and JSON size caps) while the JSON layer carries control. session = logical stream, offset = byte offset within it.

typedef esp_err_t (*helix_binary_ingest_fn)(
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len,
    const helix_transport_t *source,
    void *user_data
);

// Register the single consumer of binary chunks (later registrations replace it; NULL clears it).
esp_err_t helix_binary_channel_register(helix_binary_ingest_fn fn, void *user_data);

// Called by transports when a complete, integrity-checked binary chunk arrives.
esp_err_t helix_binary_channel_ingest(
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len,
    const helix_transport_t *source
);

// Whether `transport` can carry binary chunks outbound.
bool helix_binary_channel_supported(const helix_transport_t *transport);

// Emit one binary chunk to the host over `transport`; ESP_ERR_NOT_SUPPORTED if it can't carry binary framing.
esp_err_t helix_binary_channel_send(
    const helix_transport_t *transport,
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len
);

#ifdef __cplusplus
}
#endif
