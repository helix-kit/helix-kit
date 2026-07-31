import type { StreamTransport } from '@helix/protocol/stream';

// Backpressure ceiling across all streams: RTCDataChannel.send() never blocks, so a
// fast producer would otherwise grow bufferedAmount without bound.
const HIGH_WATER_BYTES = 1_048_576; // 1 MiB

/**
 * Adapt a WebRTC DataChannel to a HelixStream transport. The channel must be reliable
 * and ordered: the frame codec and credit/END/RESET logic assume in-order, no-loss delivery.
 */
export const dataChannelTransport = (channel: RTCDataChannel): StreamTransport => {
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = HIGH_WATER_BYTES / 2;

  // Frames queued while above the high-water mark, flushed in order when it drains.
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
    // A fresh view per message: the decoder hands payloads to the app as subarrays of it.
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
