'use client';

import type { HelixStreamSession } from '@helix/protocol/stream';

import { openPeerChannel, openRelayChannel, type DeviceChannel } from '../data-plane';

// One file transfer = one stream on the data plane; the mux gives each its own
// credit window, so several can run at once without starving each other.

export type TransferMeta = Readonly<{
  op: 'get' | 'put';
  path: string;
  size?: number;
}>;

export type TransferProgress = (bytes: number) => void;

export type TransferContext = Readonly<{
  // P2P: the browser runs the mux itself. Relay: null, and we open a WebSocket.
  peerSession: HelixStreamSession | null;
  sessionId: string;
  clientStreamUrl: string;
}>;

const openTransferChannel = (
  ctx: TransferContext,
  meta: TransferMeta,
  handlers: Parameters<typeof openPeerChannel>[2],
): DeviceChannel =>
  ctx.peerSession === null
    ? openRelayChannel(ctx.clientStreamUrl, ctx.sessionId, JSON.stringify(meta), handlers)
    : openPeerChannel(ctx.peerSession, JSON.stringify(meta), handlers);

// Download a file, streaming chunks straight to disk rather than accumulating a
// Blob, so a multi-GB file need not fit in the tab's memory.
export const downloadFile = async (
  ctx: TransferContext,
  path: string,
  sink: FileSystemWritableFileStream,
  onProgress?: TransferProgress,
): Promise<number> => {
  let received = 0;
  // Serialise writes through a promise chain: onData is synchronous but sink.write()
  // is async, and interleaving would corrupt the file's byte order.
  let queue: Promise<void> = Promise.resolve();

  const flushAndClose = (): Promise<void> => queue.then(() => sink.close());
  const abandon = (): void => {
    void queue.finally(() => sink.close().catch(() => undefined));
  };

  return new Promise<number>((resolve, reject) => {
    openTransferChannel(
      ctx,
      { op: 'get', path },
      {
        onOpen: () => {
          /* the device starts sending immediately */
        },
        onData: (chunk) => {
          received += chunk.byteLength;
          // Copy: the frame decoder hands us a view into a buffer it will reuse.
          const copy = new Uint8Array(chunk);
          queue = queue.then(() => sink.write(copy));
          onProgress?.(received);
        },
        onClose: () => {
          flushAndClose()
            .then(() => {
              resolve(received);
              return undefined;
            })
            .catch(reject);
        },
        onError: (error) => {
          abandon();
          reject(error);
        },
      },
    );
  });
};

// Upload chunk size: under the mux's 32 KiB max DATA payload so a write is never split.
const UPLOAD_CHUNK_KB = 16;
const BYTES_PER_KB = 1024;
const UPLOAD_CHUNK_BYTES = UPLOAD_CHUNK_KB * BYTES_PER_KB;

// Upload a file in chunks; backpressure from the mux's credit window keeps a fast
// disk from outrunning a slow link.
export const uploadFile = async (
  ctx: TransferContext,
  path: string,
  file: File,
  onProgress?: TransferProgress,
): Promise<number> => {
  const meta: TransferMeta = { op: 'put', path, size: file.size };
  let sent = 0;

  return new Promise<number>((resolve, reject) => {
    const channel = openTransferChannel(ctx, meta, {
      onOpen: () => {
        void (async () => {
          try {
            const reader = file.stream().getReader();
            let carry = new Uint8Array(0);
            for (;;) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              let buffer =
                carry.byteLength === 0
                  ? new Uint8Array(value)
                  : concat(carry, new Uint8Array(value));
              while (buffer.byteLength >= UPLOAD_CHUNK_BYTES) {
                // Await: this is the backpressure. Without it the mux drops everything
                // past the first 256 KiB.
                await channel.send(slice(buffer, 0, UPLOAD_CHUNK_BYTES));
                buffer = buffer.subarray(UPLOAD_CHUNK_BYTES);
                sent += UPLOAD_CHUNK_BYTES;
                onProgress?.(sent);
              }
              carry = new Uint8Array(buffer);
            }
            if (carry.byteLength > 0) {
              await channel.send(slice(carry, 0, carry.byteLength));
              sent += carry.byteLength;
              onProgress?.(sent);
            }
            // EOF: the device commits the file when its side of the stream ends.
            channel.close();
            resolve(sent);
          } catch (error: unknown) {
            channel.close();
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      },
      onData: () => {
        /* the device sends nothing back on an upload */
      },
      onClose: () => {
        /* resolved by the writer above */
      },
      onError: reject,
    });
  });
};

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
};

// A fresh, non-shared buffer — the channel's send() requires Uint8Array<ArrayBuffer>.
const slice = (source: Uint8Array, start: number, length: number): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(length));
  out.set(source.subarray(start, start + length));
  return out;
};
