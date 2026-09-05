import type { DeviceChannel, DeviceChannelHandlers } from '../data-plane';

// noVNC speaks RFB over a "raw channel" — anything shaped like a WebSocket or an
// RTCDataChannel. This adapts a Helix DeviceChannel into that shape, so the same
// viewer runs over both data-plane transports without noVNC knowing either exists.

// Websock.attach() rejects a channel missing any of these, checking own keys and
// prototype methods. They must all be own, enumerable properties here.
export type NovncRawChannel = {
  binaryType: string;
  protocol: string;
  readyState: 'connecting' | 'open' | 'closing' | 'closed';
  send: (data: Uint8Array) => void;
  close: () => void;
  onopen: (() => void) | null;
  // noVNC reads `code`/`reason` off this, so it must be CloseEvent-shaped.
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null;
};

export type NovncTransport = Readonly<{
  /** Pass this to `new RFB(container, channel, …)`. */
  channel: NovncRawChannel;
  /** Pass this to openPeerChannel / openRelayChannel. */
  handlers: DeviceChannelHandlers;
  /** Hand over the opened channel; must run before the open event is delivered. */
  setChannel: (channel: DeviceChannel) => void;
}>;

export type NovncTransportOptions = Readonly<{
  onBytesIn?: (n: number) => void;
  onBytesOut?: (n: number) => void;
}>;

// WebSocket close codes, since noVNC reports them straight to the user.
const NORMAL_CLOSURE = 1000;
const ABNORMAL_CLOSURE = 1006;

export const createNovncTransport = (options: NovncTransportOptions = {}): NovncTransport => {
  let device: DeviceChannel | null = null;
  let failed = false;
  // openPeerChannel reports open from inside its own call, so noVNC answers the
  // handshake before we hold the channel it must go out on. Hold those first bytes
  // rather than deferring the open event — the relay reports open and delivers the
  // server's greeting in one synchronous step, and noVNC rejects data it has not
  // been opened for ("Unknown init state").
  let pending: Uint8Array<ArrayBuffer>[] | null = [];

  const write = (data: Uint8Array<ArrayBuffer>): void => {
    if (device === null) {
      pending?.push(data);
      return;
    }
    void device.send(data).catch(() => {
      /* onClose owns the teardown */
    });
  };

  const channel: NovncRawChannel = {
    binaryType: 'arraybuffer',
    protocol: '',
    readyState: 'connecting',
    // noVNC hands us a view onto its reused send buffer and overwrites it as soon as
    // this returns, while HelixStream.write() may hold the bytes until the credit
    // window opens — so copy, or the stream ships whatever landed there next.
    send: (data) => {
      const copy = new Uint8Array(data);
      options.onBytesOut?.(copy.byteLength);
      write(copy);
    },
    close: () => {
      device?.close();
    },
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
  };

  const handlers: DeviceChannelHandlers = {
    onOpen: () => {
      if (channel.readyState !== 'connecting') {
        return;
      }
      channel.readyState = 'open';
      channel.onopen?.();
    },
    onData: (data) => {
      options.onBytesIn?.(data.byteLength);
      const { buffer } = data.slice();
      channel.onmessage?.({ data: buffer });
    },
    onClose: () => {
      if (channel.readyState === 'closed') {
        return;
      }
      channel.readyState = 'closed';
      channel.onclose?.({ code: failed ? ABNORMAL_CLOSURE : NORMAL_CLOSURE, reason: '' });
    },
    onError: (error) => {
      failed = true;
      channel.onerror?.(error);
    },
  };

  return {
    channel,
    handlers,
    setChannel: (opened) => {
      device = opened;
      const queued = pending ?? [];
      pending = null;
      for (const data of queued) {
        write(data);
      }
    },
  };
};
