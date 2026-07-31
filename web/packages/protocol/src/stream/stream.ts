import { encodeCredit, FrameType } from './frame';

// StreamHost is the subset of Session a Stream needs to emit frames.
export type StreamHost = Readonly<{
  sendFrame: (type: FrameType, streamId: number, payload?: Uint8Array) => void;
  removeStream: (id: number) => void;
  creditThreshold: number;
  maxChunk: number;
}>;

type PendingWrite = {
  data: Uint8Array;
  offset: number;
  resolve: () => void;
  reject: (e: Error) => void;
};

/** One bidirectional byte stream within a Session, flow-controlled by a credit window. */
export class HelixStream {
  onData?: (chunk: Uint8Array) => void;
  onEnd?: () => void;
  onClose?: (err?: Error) => void;
  onSignal?: (payload: Uint8Array) => void;

  private window: number;
  private readonly queue: PendingWrite[] = [];
  private unacked = 0;
  private sendClosed = false;
  private closed = false;

  constructor(
    readonly id: number,
    readonly meta: Uint8Array,
    private readonly host: StreamHost,
    initialWindow: number,
  ) {
    this.window = initialWindow;
  }

  /** Write bytes, resolving once they have been sent within the flow window. */
  write(data: Uint8Array): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('stream closed'));
    }
    if (this.sendClosed) {
      return Promise.reject(new Error('stream write-closed'));
    }
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ data, offset: 0, resolve, reject });
      this.flush();
    });
  }

  /** Half-close the send direction (sends END). */
  end(): void {
    if (this.sendClosed || this.closed) {
      return;
    }
    this.sendClosed = true;
    this.host.sendFrame(FrameType.End, this.id);
  }

  /** Abort the stream in both directions (sends RESET). */
  reset(reason = ''): void {
    if (!this.closed) {
      this.host.sendFrame(
        FrameType.Reset,
        this.id,
        reason === '' ? undefined : new TextEncoder().encode(reason),
      );
    }
    this.teardown(new Error(`stream reset: ${reason}`));
    this.host.removeStream(this.id);
  }

  /** Gracefully close: half-close send and remove from the session. */
  close(): void {
    this.end();
    this.teardown();
    this.host.removeStream(this.id);
  }

  /** Send an out-of-band control frame for this stream. */
  signal(payload: Uint8Array): void {
    this.host.sendFrame(FrameType.Signal, this.id, payload);
  }

  _onData(payload: Uint8Array): void {
    if (this.closed) {
      return;
    }
    this.onData?.(payload);
    this.unacked += payload.length;
    if (this.unacked >= this.host.creditThreshold) {
      const grant = this.unacked;
      this.unacked = 0;
      this.host.sendFrame(FrameType.Credit, this.id, encodeCredit(grant));
    }
  }

  _onEnd(): void {
    this.onEnd?.();
  }

  _onCredit(n: number): void {
    this.window += n;
    this.flush();
  }

  _onSignal(payload: Uint8Array): void {
    this.onSignal?.(payload);
  }

  teardown(err?: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const w of this.queue) {
      w.reject(err ?? new Error('stream closed'));
    }
    this.queue.length = 0;
    this.onClose?.(err);
  }

  private flush(): void {
    while (this.queue.length > 0 && this.window > 0) {
      const w = this.queue[0];
      if (w === undefined) {
        break;
      }
      const remaining = w.data.length - w.offset;
      const chunk = Math.min(remaining, this.window, this.host.maxChunk);
      this.host.sendFrame(FrameType.Data, this.id, w.data.subarray(w.offset, w.offset + chunk));
      this.window -= chunk;
      w.offset += chunk;
      if (w.offset >= w.data.length) {
        this.queue.shift();
        w.resolve();
      }
    }
  }
}
