// Remote-shell tunnel wire protocol (agent <-> gateway).
// Must stay byte-for-byte compatible with agent/protocol.go.
//
//   byte 0      : frame type
//   bytes 1..4  : stream id (uint32 big-endian; 0 = control)
//   bytes 5..N  : payload (raw PTY bytes, or JSON for control frames)

export const FRAME_HEADER = 5;

export enum Frame {
  REGISTER = 0x01, // agent -> gw   JSON { agentId }
  REGISTER_ACK = 0x02, // gw -> agent   JSON { ok }
  OPEN = 0x10, // gw -> agent   JSON { cols, rows }
  DATA = 0x11, // either        raw PTY bytes
  RESIZE = 0x12, // gw -> agent   JSON { cols, rows }
  CLOSE = 0x13, // either        session teardown
  EXIT = 0x14, // agent -> gw    JSON { code }
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
