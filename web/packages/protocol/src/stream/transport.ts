// Message-oriented binary carrier (a WebSocket) that moves one whole HelixStream frame per message.
export type StreamTransport = {
  send: (data: Uint8Array) => void;
  close: () => void;
  onMessage: (data: Uint8Array) => void;
  onClose: (err?: Error) => void;
};
