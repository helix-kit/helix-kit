#ifndef HELIX_STREAM_H
#define HELIX_STREAM_H

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

// Transport-agnostic byte-stream multiplexer (Helix data-plane) over an outbound mTLS WebSocket to the gateway; device is the mux server. Byte-compatible with the Go/TS reference.

typedef struct helix_stream_session helix_stream_session_t;
typedef struct helix_stream helix_stream_t;

typedef struct {
    // The peer opened a new stream (OPEN frame); meta is the app-defined open payload.
    void (*on_open)(helix_stream_t *stream, const uint8_t *meta, size_t meta_len, void *user);
    // Inbound stream bytes (DATA frame).
    void (*on_data)(helix_stream_t *stream, const uint8_t *data, size_t len, void *user);
    // Inbound out-of-band control (SIGNAL frame).
    void (*on_signal)(helix_stream_t *stream, const uint8_t *payload, size_t len, void *user);
    // The stream ended or was reset by the peer.
    void (*on_stream_close)(helix_stream_t *stream, void *user);
    // The whole session (WebSocket) closed; all streams are gone.
    void (*on_session_close)(helix_stream_session_t *session, void *user);
    void *user;
} helix_stream_callbacks_t;

typedef struct {
    const char *url;              // wss://host:4001/stream/device?session=<id>
    const char *client_cert_pem;  // device mTLS cert
    const char *client_key_pem;   // device mTLS key
    const char *root_ca_pem;      // CA that signs the gateway server cert
    helix_stream_callbacks_t cb;
} helix_stream_config_t;

// Dials the gateway data-plane WebSocket and starts serving frames asynchronously (callbacks fire on the websocket task).
esp_err_t helix_stream_session_start(const helix_stream_config_t *cfg, helix_stream_session_t **out);

// Tears down the session and all its streams.
void helix_stream_session_close(helix_stream_session_t *session);

// Writes bytes to a stream, blocking on the credit window and chunking; returns bytes written, or -1 if closed.
int helix_stream_write(helix_stream_t *stream, const uint8_t *data, size_t len);

// Like helix_stream_write but never blocks: sends only what the credit window allows; returns bytes sent, or -1 if closed.
int helix_stream_write_nonblock(helix_stream_t *stream, const uint8_t *data, size_t len);

// Half-closes the send direction (sends END).
void helix_stream_close_write(helix_stream_t *stream);

// Per-stream app pointer (set it in on_open).
void helix_stream_set_user(helix_stream_t *stream, void *user);
void *helix_stream_get_user(helix_stream_t *stream);

#endif  // HELIX_STREAM_H
