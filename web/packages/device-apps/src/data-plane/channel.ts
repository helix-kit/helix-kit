import type { HelixStreamSession } from '@helix/protocol/stream';

// One duplex byte channel to a device app, satisfied by both data-plane transports
// (relay WebSocket and p2p DataChannel) so a surface is written once and runs either way.
export type DeviceChannel = Readonly<{
  // send resolves when the mux has ACCEPTED the bytes — where backpressure lives.
  // On p2p a write blocks once the credit window is exhausted, so a bulk sender MUST
  // await it or the transfer truncates at the first window (256 KiB).
  send: (data: Uint8Array<ArrayBuffer>) => Promise<void>;
  /** An opaque app control signal (the device app interprets it). */
  signal: (text: string) => void;
  close: () => void;
}>;

export type DeviceChannelHandlers = Readonly<{
  onOpen: () => void;
  onData: (data: Uint8Array) => void;
  onClose: () => void;
  onError: (error: Error) => void;
}>;

/** The relayed channel: a plain WebSocket to the gateway's client endpoint. */
export const openRelayChannel = (
  clientStreamUrl: string,
  sessionId: string,
  meta: string,
  handlers: DeviceChannelHandlers,
): DeviceChannel => {
  const separator = clientStreamUrl.includes('?') ? '&' : '?';
  const url =
    `${clientStreamUrl}${separator}session=${encodeURIComponent(sessionId)}` +
    `&meta=${encodeURIComponent(meta)}`;
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';

  // The gateway accepts the handshake unconditionally, then closes with a text
  // rejection if no device stream is registered yet. So don't treat the bare
  // handshake as "open": confirm only on the first device byte or after a short
  // grace, and surface a rejection as a plain close so the caller's retry kicks in.
  const OPEN_GRACE_MS = 800;
  let opened = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const confirmOpen = (): void => {
    if (opened) {
      return;
    }
    opened = true;
    clearTimeout(graceTimer);
    handlers.onOpen();
  };

  socket.onopen = () => {
    graceTimer = setTimeout(confirmOpen, OPEN_GRACE_MS);
  };
  socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
    if (typeof event.data === 'string') {
      // The only text the gateway sends the client is a rejection; close so the
      // attach is retried rather than marked open.
      clearTimeout(graceTimer);
      if (!opened) {
        socket.close();
      }
      return;
    }
    confirmOpen();
    handlers.onData(new Uint8Array(event.data));
  };
  socket.onclose = () => {
    clearTimeout(graceTimer);
    handlers.onClose();
  };
  socket.onerror = () => {
    handlers.onError(new Error('data-plane socket error'));
  };

  return {
    // The relay's mux runs in the gateway, so the only backpressure is the socket's
    // own buffer; resolve once it has taken the bytes.
    send: (data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
      return Promise.resolve();
    },
    signal: (text) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(text);
      }
    },
    close: () => {
      socket.close();
    },
  };
};

/** The peer-to-peer channel: one HelixStream stream over the device's DataChannel. */
export const openPeerChannel = (
  session: HelixStreamSession,
  meta: string,
  handlers: DeviceChannelHandlers,
): DeviceChannel => {
  const stream = session.open(new TextEncoder().encode(meta));
  stream.onData = (data) => {
    handlers.onData(data);
  };
  stream.onEnd = () => {
    handlers.onClose();
  };
  stream.onClose = () => {
    handlers.onClose();
  };
  // The stream exists as soon as it is opened — no round trip to wait for.
  handlers.onOpen();

  return {
    // stream.write() resolves only once the credit window admits the bytes — this IS
    // the flow control, so hand it to the caller.
    send: (data) => stream.write(data),
    signal: (text) => {
      stream.signal(new TextEncoder().encode(text));
    },
    close: () => {
      stream.close();
    },
  };
};
