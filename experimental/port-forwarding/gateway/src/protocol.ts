// Helix port-forwarding tunnel wire protocol (experimental).
//
// Every message on the device<->gateway WebSocket is a single binary frame:
//
//   byte 0      : frame type (uint8)
//   bytes 1..4  : stream id  (uint32, big-endian)
//   bytes 5..N  : payload    (raw bytes, or JSON depending on type)
//
// stream id 0 is reserved for connection-level control (register/ack/ping).
// The gateway allocates stream ids for every browser connection it proxies.
//
// This must stay byte-for-byte compatible with agent/protocol.go.

export const FRAME_HEADER = 5;

export enum Frame {
  // --- control (stream id 0) ---
  REGISTER = 0x01, // device -> gw   JSON { sessionId, target }
  REGISTER_ACK = 0x02, // gw -> device   JSON { ok, host, error }

  // --- HTTP request/response (per stream) ---
  REQ_HEAD = 0x10, // gw -> device   JSON { method, url, headers }
  REQ_DATA = 0x11, // gw -> device   raw body bytes
  REQ_END = 0x12, // gw -> device   (no payload)
  RES_HEAD = 0x13, // device -> gw   JSON { status, headers }
  RES_DATA = 0x14, // device -> gw   raw body bytes
  RES_END = 0x15, // device -> gw   (no payload)
  ABORT = 0x16, // either        JSON { error }

  // --- WebSocket passthrough (per stream) ---
  WS_OPEN = 0x20, // gw -> device   raw HTTP upgrade request head bytes
  WS_ACK = 0x21, // device -> gw   raw HTTP response head bytes (101 ...)
  WS_DATA = 0x22, // either        raw bytes
  WS_CLOSE = 0x23, // either        (no payload)
}

export function encodeFrame(
  type: Frame,
  streamId: number,
  payload: Buffer | Uint8Array = Buffer.alloc(0),
): Buffer {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const buf = Buffer.allocUnsafe(FRAME_HEADER + body.length);
  buf.writeUInt8(type, 0);
  buf.writeUInt32BE(streamId >>> 0, 1);
  body.copy(buf, FRAME_HEADER);
  return buf;
}

export function decodeFrame(data: Buffer): {
  type: Frame;
  streamId: number;
  payload: Buffer;
} {
  return {
    type: data.readUInt8(0) as Frame,
    streamId: data.readUInt32BE(1),
    payload: data.subarray(FRAME_HEADER),
  };
}

export function encodeJson(type: Frame, streamId: number, obj: unknown): Buffer {
  return encodeFrame(type, streamId, Buffer.from(JSON.stringify(obj), "utf8"));
}

// Hop-by-hop headers must not be forwarded across the proxy boundary.
// The gateway/agent re-frame the message body themselves.
export const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
