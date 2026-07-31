import { decodeCredit, decodeFrame, encodeFrame, FrameType } from './frame';
import { HelixStream, type StreamHost } from './stream';

import type { StreamTransport } from './transport';

/** Defaults; must match the Go stream.Session (internal/stream/session.go). */
const DEFAULT_INITIAL_WINDOW_BYTES = 262_144; // 256 KiB
const DEFAULT_MAX_CHUNK_BYTES = 32_768; // 32 KiB
const DEFAULT_PING_INTERVAL_MS = 20_000;
/** Grant credit once the peer has consumed half the window. */
const CREDIT_THRESHOLD_DIVISOR = 2;
/** client => odd stream ids, server => even, so neither peer collides. */
const FIRST_CLIENT_STREAM_ID = 1;
const FIRST_SERVER_STREAM_ID = 2;

export type SessionOptions = Readonly<{
  /** client => odd stream ids, server => even, so both peers can open. */
  client: boolean;
  /** Per-stream receive window in bytes (default 256 KiB). */
  initialWindow?: number;
  /** Largest DATA payload per frame (default 32 KiB). */
  maxChunk?: number;
  /** Called for each peer-initiated stream. */
  onStream?: (stream: HelixStream) => void;
  /** Keepalive ping interval in ms (default 20000; 0 disables). */
  pingIntervalMs?: number;
}>;

/** Multiplexes many HelixStreams over one binary transport; byte-compatible with Go stream.Session. */
export class HelixStreamSession implements StreamHost {
  readonly creditThreshold: number;
  readonly maxChunk: number;

  onStream?: (stream: HelixStream) => void;
  onClose?: (err?: Error) => void;

  private readonly initialWindow: number;
  private readonly streams = new Map<number, HelixStream>();
  private nextId: number;
  private closed = false;
  private readonly pingTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly transport: StreamTransport,
    opts: SessionOptions,
  ) {
    this.initialWindow = opts.initialWindow ?? DEFAULT_INITIAL_WINDOW_BYTES;
    this.maxChunk = opts.maxChunk ?? DEFAULT_MAX_CHUNK_BYTES;
    this.creditThreshold = Math.floor(this.initialWindow / CREDIT_THRESHOLD_DIVISOR);
    this.nextId = opts.client ? FIRST_CLIENT_STREAM_ID : FIRST_SERVER_STREAM_ID;
    this.onStream = opts.onStream;

    transport.onMessage = (data) => {
      this.dispatch(data);
    };
    transport.onClose = (err) => {
      this.closeWithErr(err);
    };

    const interval = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    if (interval > 0) {
      this.pingTimer = setInterval(() => {
        this.sendFrame(FrameType.Ping, 0);
      }, interval);
    }
  }

  /** Open a new local stream; meta is an app-defined open payload. */
  open(meta?: Uint8Array): HelixStream {
    if (this.closed) {
      throw new Error('stream session closed');
    }
    const id = this.nextId;
    this.nextId += 2;
    const stream = new HelixStream(id, meta ?? new Uint8Array(0), this, this.initialWindow);
    this.streams.set(id, stream);
    this.sendFrame(FrameType.Open, id, meta);
    return stream;
  }

  close(): void {
    this.closeWithErr(undefined);
  }

  sendFrame(type: FrameType, streamId: number, payload?: Uint8Array): void {
    if (this.closed) {
      return;
    }
    try {
      this.transport.send(encodeFrame(type, streamId, payload));
    } catch (err) {
      this.closeWithErr(err instanceof Error ? err : new Error(String(err)));
    }
  }

  removeStream(id: number): void {
    this.streams.delete(id);
  }

  private dispatch(data: Uint8Array): void {
    const frame = decodeFrame(data);
    if (frame === null) {
      return;
    }
    const { type, streamId, payload } = frame;
    switch (type) {
      case FrameType.Ping:
        this.sendFrame(FrameType.Pong, 0);
        return;
      case FrameType.Pong:
        return;
      case FrameType.Open: {
        const stream = new HelixStream(streamId, payload.slice(), this, this.initialWindow);
        this.streams.set(streamId, stream);
        this.onStream?.(stream);
        return;
      }
      case FrameType.Data:
        this.streams.get(streamId)?._onData(payload);
        return;
      case FrameType.End:
        this.streams.get(streamId)?._onEnd();
        return;
      case FrameType.Reset: {
        const s = this.streams.get(streamId);
        if (s !== undefined) {
          s.teardown(new Error('peer reset'));
          this.streams.delete(streamId);
        }
        return;
      }
      case FrameType.Signal:
        this.streams.get(streamId)?._onSignal(payload);
        return;
      case FrameType.Credit:
        this.streams.get(streamId)?._onCredit(decodeCredit(payload));
        return;
      default:
        return;
    }
  }

  private closeWithErr(err?: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.pingTimer !== undefined) {
      clearInterval(this.pingTimer);
    }
    for (const stream of this.streams.values()) {
      stream.teardown(err);
    }
    this.streams.clear();
    try {
      this.transport.close();
    } catch {
      /* already closed */
    }
    this.onClose?.(err);
  }
}
