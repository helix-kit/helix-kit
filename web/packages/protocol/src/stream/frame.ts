// HelixStream wire frame codec. Must stay byte-compatible with the Go
// implementation in linux/device/go/internal/stream/frame.go.
//
//   byte 0      frame type
//   bytes 1..4  stream id (uint32, big-endian; 0 = connection control)
//   bytes 5..N  payload

export const FRAME_HEADER = 5;

/** Width of the uint32 fields on the wire (stream id, credit grant). */
const UINT32_BYTES = 4;

/* eslint-disable no-magic-numbers -- these are wire-format opcodes: the numeric
   value IS the specification, and must stay byte-identical to the Go encoder in
   linux/device/go/internal/stream/frame.go. Naming them twice would not help. */
export enum FrameType {
  Open = 0x01, // new stream; payload = app-defined open meta
  Data = 0x02, // raw stream bytes
  End = 0x03, // half-close: no more DATA this direction
  Reset = 0x04, // abort stream; payload optional reason
  Signal = 0x05, // app control for a stream (e.g. shell resize)
  Credit = 0x06, // flow-control: payload uint32 bytes granted
  Ping = 0x10, // connection keepalive (stream id 0)
  Pong = 0x11, // keepalive reply (stream id 0)
}
/* eslint-enable no-magic-numbers */

export type Frame = Readonly<{
  type: FrameType;
  streamId: number;
  payload: Uint8Array;
}>;

const EMPTY = new Uint8Array(0);

export const encodeFrame = (
  type: FrameType,
  streamId: number,
  payload: Uint8Array = EMPTY,
): Uint8Array => {
  const out = new Uint8Array(FRAME_HEADER + payload.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, streamId >>> 0, false);
  out.set(payload, FRAME_HEADER);
  return out;
};

export const decodeFrame = (data: Uint8Array): Frame | null => {
  if (data.length < FRAME_HEADER) {
    return null;
  }
  const type = data[0] as FrameType;
  const streamId = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1, false);
  return { type, streamId, payload: data.subarray(FRAME_HEADER) };
};

export const encodeCredit = (n: number): Uint8Array => {
  const b = new Uint8Array(UINT32_BYTES);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
};

export const decodeCredit = (p: Uint8Array): number => {
  if (p.length < UINT32_BYTES) {
    return 0;
  }
  return new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(0, false);
};
