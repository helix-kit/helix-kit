'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { selectedCandidatePair } from '@helix-hq/protocol/peer';

import {
  openFailureMessage,
  openSession,
  type DataPlaneTransport,
  type OpenedSession,
  type SessionService,
} from './open-session';
import { useIceServers } from './use-ice-servers';

import type { HelixStreamSession } from '@helix-hq/protocol/stream';

// The session lifecycle every stream app repeats: pick a transport, wait for ICE,
// open exactly one session, expose the negotiated path, and tear it all down on a
// transport switch. Shared so shell / files / port-forward cannot drift apart on it.

export type DataPlaneSessionOptions = Readonly<{
  service: SessionService;
  /** True once the control plane is connected — nothing opens before it. */
  isConnected: boolean;
  /** Relay only: the gateway URL the device dials. */
  deviceStreamUrl: string;
  /** Tag used in open-failure diagnostics, e.g. 'helix-shell'. */
  failureTag: string;
  /** Transport used for the first session. */
  initialTransport?: DataPlaneTransport;
  /** An extra gate: hold the open until the consumer can accept it (e.g. the terminal has mounted). */
  ready?: boolean;
  /** Extra fields for the app's `open` command. */
  params?: Readonly<Record<string, unknown>>;
  /** The session is live. Runs before the caller renders as connected. */
  onOpen?: (session: OpenedSession) => void;
  /** The open failed; `message` is already humanised. */
  onError?: (message: string) => void;
  /** Runs before a session is discarded, so the caller can drop what it layered on top. */
  onTeardown?: () => void;
}>;

export type DataPlaneSessionHandle = Readonly<{
  transport: DataPlaneTransport;
  /** Switching tears the current session down and opens a fresh one. */
  setTransport: (value: DataPlaneTransport) => void;
  /** P2P only: force the peer through TURN even when a direct path exists. */
  forceRelay: boolean;
  setForceRelay: (value: boolean) => void;
  /** The negotiated ICE candidate pair, or null on relay / before it settles. */
  icePath: string | null;
  /** The live session id, for render. */
  sessionId: string | null;
  /** The p2p mux; null on relay, where the gateway runs it instead. */
  peerSession: HelixStreamSession | null;
  /** The same two, read imperatively — for callbacks that must not close over a stale render. */
  current: () => { sessionId: string | null; peerSession: HelixStreamSession | null };
  isOpen: boolean;
  error: string | null;
  /** Tear the session down and open a new one. */
  reconnect: () => void;
}>;

export const useDataPlaneSession = (options: DataPlaneSessionOptions): DataPlaneSessionHandle => {
  const {
    service,
    isConnected,
    deviceStreamUrl,
    failureTag,
    initialTransport = 'relay',
    ready = true,
    params,
    onOpen,
    onError,
    onTeardown,
  } = options;

  const [transport, setTransportState] = useState<DataPlaneTransport>(initialTransport);
  const [forceRelay, setForceRelayState] = useState(false);
  const [icePath, setIcePath] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [peerSession, setPeerSession] = useState<HelixStreamSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const sessionRef = useRef<string | null>(null);
  const peerSessionRef = useRef<HelixStreamSession | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  // Effect callbacks live in a ref so a caller may pass inline closures without
  // re-opening the session on every render.
  const callbacks = useRef({ onOpen, onError, onTeardown });
  callbacks.current = { onOpen, onError, onTeardown };

  const current = useCallback(
    () => ({ sessionId: sessionRef.current, peerSession: peerSessionRef.current }),
    [],
  );

  const reportIcePath = useCallback((connection: RTCPeerConnection | null) => {
    if (connection === null) {
      setIcePath(null);
      return;
    }
    void selectedCandidatePair(connection).then((pair) => {
      setIcePath(pair === null ? null : `${pair.local}/${pair.remote}`);
      return undefined;
    });
  }, []);

  // ICE servers must be in hand before opening: they are passed to the device in the
  // `open` command, and a device that gathers no candidates can only fail to connect.
  const { iceServers, isLoading: iceLoading } = useIceServers(transport === 'p2p');

  const teardown = useCallback(() => {
    callbacks.current.onTeardown?.();
    closeRef.current?.();
    closeRef.current = null;
    sessionRef.current = null;
    peerSessionRef.current = null;
    setSessionId(null);
    setPeerSession(null);
    setIcePath(null);
    setError(null);
  }, []);

  const reconnect = useCallback(() => {
    teardown();
    setNonce((value) => value + 1);
  }, [teardown]);

  const setTransport = useCallback(
    (value: DataPlaneTransport) => {
      setTransportState(value);
      reconnect();
    },
    [reconnect],
  );

  const setForceRelay = useCallback(
    (value: boolean) => {
      setForceRelayState(value);
      reconnect();
    },
    [reconnect],
  );

  useEffect(() => {
    if (!isConnected || !ready || sessionRef.current !== null) {
      return;
    }
    // Opening without the ICE config is a guaranteed failure, not a degraded connection.
    if (transport === 'p2p' && iceLoading) {
      return;
    }
    const id = crypto.randomUUID();
    sessionRef.current = id;

    void openSession({
      service,
      sessionId: id,
      transport,
      deviceStreamUrl,
      iceServers,
      ...(params === undefined ? {} : { params }),
      ...(transport === 'p2p' && forceRelay ? { iceTransportPolicy: 'relay' as const } : {}),
    })
      .then((session) => {
        // Bail if the caller reconnected or switched transport while we negotiated.
        if (sessionRef.current !== id) {
          session.close();
          return undefined;
        }
        peerSessionRef.current = session.peerSession;
        closeRef.current = session.close;
        setPeerSession(session.peerSession);
        setSessionId(id);
        setError(null);
        reportIcePath(session.connection);
        callbacks.current.onOpen?.(session);
        return undefined;
      })
      .catch((cause: unknown) => {
        if (sessionRef.current !== id) {
          return;
        }
        const message = openFailureMessage(cause, failureTag);
        setError(message);
        callbacks.current.onError?.(message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, ready, transport, forceRelay, deviceStreamUrl, iceServers, iceLoading, nonce]);

  return {
    transport,
    setTransport,
    forceRelay,
    setForceRelay,
    icePath,
    sessionId,
    peerSession,
    current,
    isOpen: sessionId !== null,
    error,
    reconnect,
  };
};
