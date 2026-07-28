// A StreamTransport is a message-oriented binary carrier (a WebSocket) that
// moves one whole HelixStream frame per message. The Session sets onMessage /
// onClose; the binding (Node `ws` server-side, browser WebSocket client-side)
// forwards raw binary frames.

export type StreamTransport = {
  send: (data: Uint8Array) => void;
  close: () => void;
  onMessage: (data: Uint8Array) => void;
  onClose: (err?: Error) => void;
};
