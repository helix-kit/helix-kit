import type { StreamTransport } from '@helix/protocol-stream';

// Backpressure ceiling for the send buffer. RTCDataChannel.send() never blocks —
// unlike a WebSocket, which at least applies TCP pressure — so a fast producer
// (a file transfer) would otherwise grow bufferedAmount without bound until the
// channel is torn down. The mux's per-stream credit window bounds ONE stream; this
// bounds the sum across all of them.
const HIGH_WATER_BYTES = 1_048_576; // 1 MiB

/**
 * Adapts a WebRTC DataChannel to a HelixStream transport, so the SAME multiplexer
 * the gateway runs over a WebSocket runs here over a peer connection — and every
 * stream app (shell, port-forward, file transfer) works over either.
 *
 * The channel must be reliable + ordered: the frame codec assumes one whole frame
 * per message, and the credit/END/RESET logic assumes in-order, no-loss delivery.
 */
export const dataChannelTransport = (channel: RTCDataChannel): StreamTransport => {
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = HIGH_WATER_BYTES / 2;

  // Frames queued while the send buffer is above the high-water mark, flushed in
  // order when it drains. Order matters — the mux's framing is a stream.
  const backlog: Uint8Array[] = [];
  let flushing = false;

  const transport: StreamTransport = {
    send: (data) => {
      if (channel.readyState !== 'open') {
        return;
      }
      if (flushing || channel.bufferedAmount > HIGH_WATER_BYTES) {
        flushing = true;
        backlog.push(data);
        return;
      }
      channel.send(data as unknown as ArrayBufferView as Uint8Array<ArrayBuffer>);
    },
    close: () => {
      channel.close();
    },
    onMessage: () => {
      /* set by HelixStreamSession */
    },
    onClose: () => {
      /* set by HelixStreamSession */
    },
  };

  channel.addEventListener('bufferedamountlow', () => {
    while (backlog.length > 0 && channel.bufferedAmount <= HIGH_WATER_BYTES) {
      const next = backlog.shift();
      if (next !== undefined && channel.readyState === 'open') {
        channel.send(next as Uint8Array<ArrayBuffer>);
      }
    }
    flushing = backlog.length > 0;
  });

  channel.addEventListener('message', (event: MessageEvent<ArrayBuffer>) => {
    // A fresh view per message: the frame decoder hands payloads to the app as
    // subarrays of this buffer, so it must not be reused.
    transport.onMessage(new Uint8Array(event.data));
  });

  channel.addEventListener('close', () => {
    transport.onClose();
  });

  channel.addEventListener('error', () => {
    transport.onClose(new Error('peer data channel error'));
  });

  return transport;
};
