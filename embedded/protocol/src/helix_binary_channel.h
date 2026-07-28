#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "helix_transport.h"

#ifdef __cplusplus
extern "C" {
#endif

// Transport-agnostic binary data side-channel, bidirectional.
//
// The JSON message layer (helix_protocol / service_dispatcher) carries control
// planes (file transfer's begin/commit/abort, the UI service's pointer input).
// Bulk payload bytes travel out-of-band as raw binary frames so they avoid
// base64 inflation and the JSON packet-size caps. Every transport that can carry
// binary framing (serial today, BLE next) parses its own framing and forwards
// decoded chunks here (ingress), and encodes chunks handed to it (egress).
//
// Ingress has a single consumer -- the file-transfer service, receiving uploads.
// Egress is caller-directed: the sender names the transport to write to, so the
// UI service can stream display frames out over whichever transport it arrived
// on. `session` identifies the logical stream (a transfer handle inbound, a
// frame id outbound); `offset` is the byte offset of this chunk within it.

typedef esp_err_t (*helix_binary_ingest_fn)(
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len,
    const helix_transport_t *source,
    void *user_data
);

// Register the single consumer of binary chunks. Later registrations replace
// the previous one. Passing NULL clears the consumer.
esp_err_t helix_binary_channel_register(helix_binary_ingest_fn fn, void *user_data);

// Called by transports when a complete, integrity-checked binary chunk arrives.
// Returns ESP_ERR_INVALID_STATE if no consumer is registered.
esp_err_t helix_binary_channel_ingest(
    uint16_t session,
    uint32_t offset,
    const uint8_t *data,
    size_t len,
    const helix_transport_t *source
);

// Whether `transport` can carry binary chunks outbound.
bool helix_binary_channel_supported(const helix_transport_t *transport);

// Emit one binary chunk to the host over `transport`, which must support binary
// framing. Returns ESP_ERR_NOT_SUPPORTED otherwise.
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
