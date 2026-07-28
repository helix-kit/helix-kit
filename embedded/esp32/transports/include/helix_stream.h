#ifndef HELIX_STREAM_H
#define HELIX_STREAM_H

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

// HelixStream: the transport-agnostic byte-stream multiplexer (the Helix
// data-plane), implemented over an outbound mTLS WebSocket to the gateway's
// /stream/device endpoint. Byte-compatible with the Go/TS reference
// (linux/device/go/internal/stream, web/packages/protocol/protocol-stream):
//
//   byte 0      frame type
//   bytes 1..4  stream id (uint32 big-endian; 0 = connection control)
//   bytes 5..N  payload
//
// The device is the mux SERVER (it Accepts peer-opened streams); the gateway is
// the client. Credit-windowed flow control keeps one stream from starving the
// connection. This carries opaque bytes — a UART console, a shell, a forwarded
// socket — it knows nothing about any of them.

typedef struct helix_stream_session helix_stream_session_t;
typedef struct helix_stream helix_stream_t;

typedef struct {
    // The peer opened a new stream (OPEN frame). meta is the app-defined open
    // payload (JSON, may be empty). Bind the stream to your app here.
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

// Dials the gateway data-plane WebSocket and starts serving frames. The session
// runs asynchronously; callbacks fire on the websocket task. Returns once the
// dial is initiated (connection completes in the background).
esp_err_t helix_stream_session_start(const helix_stream_config_t *cfg, helix_stream_session_t **out);

// Tears down the session and all its streams.
void helix_stream_session_close(helix_stream_session_t *session);

// Writes bytes to a stream, blocking on the credit window and chunking to the
// max frame size. Returns bytes written, or -1 if the stream/session is closed.
int helix_stream_write(helix_stream_t *stream, const uint8_t *data, size_t len);

// Like helix_stream_write but never blocks: sends only what the current credit
// window allows in one call (dropping the rest under extreme backpressure).
// Safe to call while holding a caller lock. Returns bytes sent, or -1 if closed.
int helix_stream_write_nonblock(helix_stream_t *stream, const uint8_t *data, size_t len);

// Half-closes the send direction (sends END).
void helix_stream_close_write(helix_stream_t *stream);

// Per-stream app pointer (set it in on_open).
void helix_stream_set_user(helix_stream_t *stream, void *user);
void *helix_stream_get_user(helix_stream_t *stream);

#endif  // HELIX_STREAM_H
