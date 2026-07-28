'use client';

// The three URLs every stream app needs. They derive from `window.location`, so
// they exist only in the browser — and they are shared, so shell / files /
// port-forward cannot drift apart on how they address the gateway.

export type StreamConfig = Readonly<{
  /** Control plane: the gateway WebSocket (HelixPacket JSON over MQTT). */
  gateway: string;
  /** The data-plane URL the DEVICE dials, on the mTLS listener. Relay only. */
  device: string;
  /** The browser's own data-plane endpoint. Relay only. */
  client: string;
}>;

// Control rides the gateway WS (same origin, Caddy → helix-server), overridable
// for local dev where the Next app and helix-server are on different ports.
const gatewayWsUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_HELIX_GATEWAY_WS_URL;
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
};

// The device-facing data-plane URL the device dials (mTLS, direct on 4001).
//
// NB: this must be overridden whenever the site sits behind a proxy that only
// carries HTTP — the device cannot reach :4001 through a CDN, so it dials the
// ORIGIN, and that host has to be a SAN on the mTLS cert. It is inlined at build
// time (NEXT_PUBLIC_*), not read at runtime.
const deviceStreamUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_HELIX_DEVICE_STREAM_URL;
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  return `wss://${window.location.hostname}:4001/stream/device`;
};

// The browser's own data-plane endpoint. Same origin (Caddy → helix-server) in a
// real deployment; overridable for local dev where the Next app and helix-server
// are on different ports.
const clientStreamUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_HELIX_CLIENT_STREAM_URL;
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/stream/client`;
};

// Memoised at module scope: useClientOnly compares snapshots by identity, so this
// must return the same object every call.
let cached: StreamConfig | null = null;

export const getStreamConfig = (): StreamConfig =>
  (cached ??= {
    gateway: gatewayWsUrl(),
    device: deviceStreamUrl(),
    client: clientStreamUrl(),
  });
