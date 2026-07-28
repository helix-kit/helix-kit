// @helix/protocol-stream — HelixStream: a transport-agnostic multiplexer that
// carries many bidirectional byte streams over one binary connection. It is the
// TypeScript peer of linux/device/go/internal/stream and is byte-compatible
// with it. Used server-side (the gateway) to bridge browser/subdomain traffic
// to a device's data-plane connection.

export {
  FRAME_HEADER,
  FrameType,
  decodeFrame,
  encodeFrame,
  decodeCredit,
  encodeCredit,
} from './frame';
export type { Frame } from './frame';
export { HelixStream } from './stream';
export type { StreamHost } from './stream';
export { HelixStreamSession } from './session';
export type { SessionOptions } from './session';
export type { StreamTransport } from './transport';
