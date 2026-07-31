// @helix/protocol/stream — HelixStream: transport-agnostic multiplexer for many bidirectional byte streams over one binary connection; byte-compatible TS peer of linux/device/go/internal/stream.

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
