import type { HelixStreamSession } from '@helix/protocol-stream';

// One duplex byte channel to a device app — a terminal, a forwarded connection, a
// file transfer. Exactly the shape the shell terminal already used when it talked
// raw WebSocket to /stream/client:
//
//   binary out = payload (keystrokes, file bytes)
//   text   out = an opaque app control signal (the shell's {type:'resize'})
//   binary in  = payload back
//
// Both data-plane transports satisfy it, so a surface is written once and runs
// either way:
//
//   relay — a WebSocket to /stream/client; the GATEWAY runs the HelixStream mux on
//           the browser's behalf and this channel is the one stream it opened.
//   p2p   — one HelixStream stream over a WebRTC DataChannel; the browser runs the
//           mux itself, because there is no gateway in the middle.
export type DeviceChannel = Readonly<{
  // Uint8Array<ArrayBuffer> (not the wider ArrayBufferLike): WebSocket.send and
  // RTCDataChannel.send both reject a possibly-shared buffer.
  //
  // Returns a promise that settles when the mux has ACCEPTED the bytes — which is
  // where backpressure lives. On the p2p path a write blocks once the stream's
  // credit window is exhausted, so a bulk sender (an upload) MUST await it. Firing
  // and forgetting silently truncates the transfer at the first window (256 KiB).
  // A keystroke sender can ignore the promise; a file sender cannot.
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

/**
 * The relayed channel: a plain WebSocket to the gateway's client endpoint. `meta`
 * is opaque and reaches the device app as the stream's meta blob.
 */
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

  // The gateway ACCEPTS the WebSocket handshake unconditionally, then — if no
  // device stream is registered for this session yet — sends a text
  // `{type:'error'}` control frame and closes. A fast (local Go) device is
  // registered before the handshake even completes; a slower one (an ESP32
  // bridge dialling /stream/device over mTLS) is not, so the first attach is
  // rejected and the caller must retry. So we must NOT treat the bare handshake
  // as "open": we confirm open only on the first device byte, or after a short
  // grace with no rejection — and surface the rejection as a plain close so the
  // caller's retry (which fires only while not yet open) kicks in.
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
      // The only text the gateway sends the client is a rejection. Drop the
      // grace timer and close so the attach is retried (not marked open).
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
    // The relay's mux runs in the gateway, so the browser's only backpressure is
    // the socket's own buffer; resolve once it has taken the bytes.
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

/**
 * The peer-to-peer channel: one stream on the HelixStream session running over the
 * device's DataChannel. The `meta` blob and the text signals land in exactly the
 * same place on the device (stream meta + SIGNAL frames) as on the relayed path —
 * which is why the device app needs no transport-specific code.
 */
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
  // The stream exists as soon as it is opened — there is no round trip to wait for,
  // unlike the relay's WebSocket handshake.
  handlers.onOpen();

  return {
    // stream.write() resolves only once the credit window admits the bytes — this
    // IS the flow control, so hand it to the caller rather than dropping it.
    send: (data) => stream.write(data),
    signal: (text) => {
      stream.signal(new TextEncoder().encode(text));
    },
    close: () => {
      stream.close();
    },
  };
};
