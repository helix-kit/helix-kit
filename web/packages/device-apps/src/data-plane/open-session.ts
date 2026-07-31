import { connectPeer, type IceServer } from '@helix/protocol/peer';

import type { HelixStreamSession } from '@helix/protocol/stream';

// Opening a data-plane session over either transport from the browser's side.

export type DataPlaneTransport = 'relay' | 'p2p';

// The subset of a typed device-service client this needs; structural so it works
// with any app's generated contract.
export type SessionService = Readonly<{
  request: (method: string, payload: unknown) => Promise<unknown>;
  subscribe: (
    handler: (packet: { message: { method: string; payload: unknown } }) => void,
    matcher?: { method?: string; service?: string },
  ) => () => void;
}>;

export type OpenSessionOptions = Readonly<{
  service: SessionService;
  sessionId: string;
  transport: DataPlaneTransport;
  /** Extra fields for the app's `open` command (port-forward's `target`, …). */
  params?: Readonly<Record<string, unknown>>;
  /** Relay only: the gateway URL the device dials. */
  deviceStreamUrl?: string;
  /** P2P only: from the `ice.config` procedure. */
  iceServers?: readonly IceServer[];
  /** P2P only: 'relay' forces the session through TURN. */
  iceTransportPolicy?: RTCIceTransportPolicy;
}>;

export type OpenedSession = Readonly<{
  sessionId: string;
  /** Null on the relay path — there the gateway runs the mux, not the browser. */
  peerSession: HelixStreamSession | null;
  media: MediaStream | null;
  connection: RTCPeerConnection | null;
  close: () => void;
}>;

const CANDIDATE_METHOD = 'candidate';

// The URL may already carry query params, so append rather than assume.
const withSession = (url: string, sessionId: string): string =>
  `${url}${url.includes('?') ? '&' : '?'}session=${encodeURIComponent(sessionId)}`;

/** Explain an openSession failure; a timeout usually means the app isn't running. */
export const openFailureMessage = (error: unknown, appBinary: string): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes('timed out')) {
    return `No response from the device. Is ${appBinary} running on it?`;
  }
  return message;
};

/** Ask the device to open a session and, for p2p, complete the WebRTC handshake. */
export const openSession = async (options: OpenSessionOptions): Promise<OpenedSession> => {
  if (options.transport === 'relay') {
    await options.service.request('open', {
      sessionId: options.sessionId,
      dataUrl: withSession(options.deviceStreamUrl ?? '', options.sessionId),
      transport: 'relay',
      ...options.params,
    });
    return {
      sessionId: options.sessionId,
      peerSession: null,
      media: null,
      connection: null,
      close: () => {
        void options.service.request('close', { sessionId: options.sessionId });
      },
    };
  }

  // The device answers `open` with its SDP offer, so one round trip both creates the
  // session and starts the handshake.
  const opened = (await options.service.request('open', {
    sessionId: options.sessionId,
    transport: 'p2p',
    iceServers: options.iceServers ?? [],
    ...(options.iceTransportPolicy === undefined
      ? {}
      : { iceTransportPolicy: options.iceTransportPolicy }),
    ...options.params,
  })) as { offer?: string };

  if (opened.offer === undefined || opened.offer === '') {
    throw new Error('device did not return a WebRTC offer');
  }

  const peer = connectPeer({
    offer: opened.offer,
    iceServers: options.iceServers ?? [],
    ...(options.iceTransportPolicy === undefined
      ? {}
      : { iceTransportPolicy: options.iceTransportPolicy }),
    signaller: {
      send: (signal) =>
        options.service.request('signal', { sessionId: options.sessionId, ...signal }),
      onCandidate: (handler) =>
        options.service.subscribe(
          (packet) => {
            if (packet.message.method !== CANDIDATE_METHOD) {
              return;
            }
            const payload = packet.message.payload as {
              sessionId?: string;
              candidate?: string;
            };
            // A browser may own several sessions on one device: take only this one's candidates.
            if (payload.sessionId === options.sessionId && payload.candidate !== undefined) {
              handler(payload.candidate);
            }
          },
          { method: CANDIDATE_METHOD },
        ),
    },
  });

  const peerSession = await peer.session;
  return {
    sessionId: options.sessionId,
    peerSession,
    media: peer.media,
    connection: peer.connection,
    close: () => {
      peer.close();
      void options.service.request('close', { sessionId: options.sessionId });
    },
  };
};
