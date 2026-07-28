import { HelixStreamSession } from '@helix/protocol-stream';

import { dataChannelTransport } from './transport';

// The browser half of the Helix WebRTC data plane.
//
// The DEVICE is the offerer and creates the DataChannel (it also has no inbound
// reachability to rely on), so the browser's job is: take the offer that came back
// in the `open` response, answer it, trickle ICE, and wait for the channel. Once
// the channel opens, the browser speaks HelixStream over it directly — there is no
// gateway in the middle to mux for it, as there is on the relayed path.
//
// Signaling rides the ordinary typed control plane (the same MQTT gateway that
// carries `open`/`close`), so this package owns no transport of its own.

export type IceServer = Readonly<{
  urls: readonly string[];
  username?: string;
  credential?: string;
}>;

export type PeerSignaller = Readonly<{
  /** Send our SDP answer / one ICE candidate to the device, via `signal`. */
  send: (signal: { answer?: string; candidate?: string }) => Promise<unknown>;
  /**
   * Subscribe to the device's trickled ICE candidates. The gateway routes them to
   * this browser alone (it owns the session), so no filtering by peer is needed —
   * but candidates for OTHER sessions on the same device would still arrive, hence
   * the sessionId check at the call site.
   */
  onCandidate: (handler: (candidate: string) => void) => () => void;
}>;

export type PeerOptions = Readonly<{
  /** The device's SDP offer, returned by the app's `open` command. */
  offer: string;
  iceServers: readonly IceServer[];
  /** 'relay' forces the connection through TURN; 'all' allows a direct path. */
  iceTransportPolicy?: RTCIceTransportPolicy;
  signaller: PeerSignaller;
}>;

export type HelixPeer = Readonly<{
  connection: RTCPeerConnection;
  /** Resolves when the device's DataChannel is open and the mux is live. */
  session: Promise<HelixStreamSession>;
  /** The device's media tracks (live video/audio), as they arrive. */
  media: MediaStream;
  close: () => void;
}>;

/**
 * Answer a device's offer and bring up the peer. Resolves as soon as the answer is
 * sent — the DataChannel opens asynchronously, so await `session` for the mux.
 */
export const connectPeer = (options: PeerOptions): HelixPeer => {
  const connection = new RTCPeerConnection({
    iceServers: options.iceServers.map((server) => ({
      urls: [...server.urls],
      ...(server.username === undefined ? {} : { username: server.username }),
      ...(server.credential === undefined ? {} : { credential: server.credential }),
    })),
    ...(options.iceTransportPolicy === undefined
      ? {}
      : { iceTransportPolicy: options.iceTransportPolicy }),
  });

  const media = new MediaStream();
  connection.addEventListener('track', (event: RTCTrackEvent) => {
    media.addTrack(event.track);
  });

  let resolveSession: (session: HelixStreamSession) => void;
  let rejectSession: (reason: Error) => void;
  const session = new Promise<HelixStreamSession>((resolve, reject) => {
    resolveSession = resolve;
    rejectSession = reject;
  });

  connection.addEventListener('datachannel', ({ channel }: RTCDataChannelEvent) => {
    const open = (): void => {
      // The browser is the mux client (odd stream ids); the device is the server
      // (even) — the same parity the relayed gateway uses, so the device app's
      // accept loop is identical on both transports.
      resolveSession(new HelixStreamSession(dataChannelTransport(channel), { client: true }));
    };
    if (channel.readyState === 'open') {
      open();
    } else {
      channel.addEventListener('open', open, { once: true });
    }
  });

  connection.addEventListener('connectionstatechange', () => {
    if (connection.connectionState === 'failed') {
      rejectSession(new Error('peer connection failed'));
    }
  });

  connection.addEventListener('icecandidate', (event: RTCPeerConnectionIceEvent) => {
    if (event.candidate !== null) {
      void options.signaller.send({ candidate: JSON.stringify(event.candidate.toJSON()) });
    }
  });

  const unsubscribe = options.signaller.onCandidate((candidate) => {
    void connection.addIceCandidate(JSON.parse(candidate) as RTCIceCandidateInit).catch(() => {
      // A candidate that arrives before the remote description, or one for a path
      // already discarded, is normal — ICE is best-effort per candidate.
    });
  });

  const negotiate = async (): Promise<void> => {
    await connection.setRemoteDescription({ type: 'offer', sdp: options.offer });
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await options.signaller.send({ answer: answer.sdp ?? '' });
  };

  void negotiate().catch((error: unknown) => {
    rejectSession(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    connection,
    session,
    media,
    close: () => {
      unsubscribe();
      connection.close();
    },
  };
};

/**
 * The ICE candidate pair actually in use — `host`/`srflx` means a DIRECT path (no
 * cloud bandwidth), `relay` means TURN. Worth surfacing: a session that silently
 * fell back to relay costs bandwidth, which is the thing P2P exists to avoid.
 */
type CandidatePairReport = {
  type: string;
  state?: string;
  nominated?: boolean;
  selected?: boolean;
  localCandidateId?: string;
  remoteCandidateId?: string;
};

export const selectedCandidatePair = async (
  connection: RTCPeerConnection,
): Promise<{ local: string; remote: string } | null> => {
  const stats = await connection.getStats();
  // Collect, then pick: assigning inside the forEach callback defeats TypeScript's
  // control-flow narrowing, which then treats the null check below as dead code.
  const succeeded: CandidatePairReport[] = [];
  stats.forEach((report: unknown) => {
    const candidatePair = report as CandidatePairReport;
    if (
      candidatePair.type === 'candidate-pair' &&
      candidatePair.state === 'succeeded' &&
      (candidatePair.nominated === true || candidatePair.selected === true)
    ) {
      succeeded.push(candidatePair);
    }
  });
  const pair = succeeded.at(-1);
  if (pair === undefined) {
    return null;
  }
  const candidateType = (id: string | undefined): string => {
    if (id === undefined) {
      return 'unknown';
    }
    const report = stats.get(id) as { candidateType?: string } | undefined;
    return report?.candidateType ?? 'unknown';
  };
  return {
    local: candidateType(pair.localCandidateId),
    remote: candidateType(pair.remoteCandidateId),
  };
};
