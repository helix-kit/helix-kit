import { HelixStreamSession } from '@helix/protocol-stream';

import { dataChannelTransport } from './transport';

// The browser half of the Helix WebRTC data plane. The device is the offerer; the
// browser answers, trickles ICE, and speaks HelixStream over the channel directly.
// Signaling rides the ordinary typed control plane, so this package owns no transport.

export type IceServer = Readonly<{
  urls: readonly string[];
  username?: string;
  credential?: string;
}>;

export type PeerSignaller = Readonly<{
  /** Send our SDP answer / one ICE candidate to the device, via `signal`. */
  send: (signal: { answer?: string; candidate?: string }) => Promise<unknown>;
  /** Subscribe to the device's trickled ICE candidates. */
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

/** Answer a device's offer and bring up the peer; await `session` for the mux. */
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
      // Browser is the mux client (odd stream ids), device the server — the same
      // parity the relayed gateway uses, so the device's accept loop is identical.
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
      // A candidate arriving before the remote description is normal — ICE is best-effort.
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

type CandidatePairReport = {
  type: string;
  state?: string;
  nominated?: boolean;
  selected?: boolean;
  localCandidateId?: string;
  remoteCandidateId?: string;
};

/** The ICE candidate pair in use — `host`/`srflx` is a direct path, `relay` is TURN. */
export const selectedCandidatePair = async (
  connection: RTCPeerConnection,
): Promise<{ local: string; remote: string } | null> => {
  const stats = await connection.getStats();
  // Collect, then pick: assigning inside the forEach callback defeats TS's
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
