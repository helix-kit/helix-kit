'use client';

// The three URLs every stream app needs, shared so shell / files / port-forward
// cannot drift apart on how they address the gateway.

export type StreamConfig = Readonly<{
  /** Control plane: the gateway WebSocket (HelixPacket JSON over MQTT). */
  gateway: string;
  /** The data-plane URL the DEVICE dials, on the mTLS listener. Relay only. */
  device: string;
  /** The browser's own data-plane endpoint. Relay only. */
  client: string;
}>;

// Same origin (Caddy → helix-server), overridable for local dev on split ports.
const gatewayWsUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_HELIX_GATEWAY_WS_URL;
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
};

// The device-facing data-plane URL (mTLS, direct on 4001). Must be overridden behind
// an HTTP-only proxy: the device dials the origin, which must be a SAN on the mTLS cert.
const deviceStreamUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_HELIX_DEVICE_STREAM_URL;
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  return `wss://${window.location.hostname}:4001/stream/device`;
};

// The browser's own data-plane endpoint. Same origin; overridable for local dev.
const clientStreamUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_HELIX_CLIENT_STREAM_URL;
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/stream/client`;
};

// Memoised: useClientOnly compares snapshots by identity, so return the same object.
let cached: StreamConfig | null = null;

export const getStreamConfig = (): StreamConfig =>
  (cached ??= {
    gateway: gatewayWsUrl(),
    device: deviceStreamUrl(),
    client: clientStreamUrl(),
  });
