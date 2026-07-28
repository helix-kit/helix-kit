import type { StreamTransport } from '@helix/protocol-stream';
import type { WebSocket } from 'ws';

/**
 * Adapt a Node `ws` WebSocket to the HelixStream StreamTransport. The
 * HelixStreamSession guarantees one reader and serialized writes, matching
 * what `ws` expects.
 */
export const wsTransport = (socket: WebSocket): StreamTransport => {
  const transport: StreamTransport = {
    send: (data) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(data, { binary: true });
      }
    },
    close: () => {
      socket.close();
    },
    onMessage: () => {},
    onClose: () => {},
  };
  socket.binaryType = 'nodebuffer';
  socket.on('message', (data: Buffer) => {
    // Copy out of the pooled Buffer into a tight Uint8Array.
    transport.onMessage(new Uint8Array(data));
  });
  socket.on('close', () => {
    transport.onClose();
  });
  socket.on('error', (err: Error) => {
    transport.onClose(err);
  });
  return transport;
};
