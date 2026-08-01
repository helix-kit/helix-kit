'use client';

import type { DataPlaneTransport } from './open-session';

// The relay/p2p toggle every stream app puts in its header, shared so the apps
// cannot describe the same two transports differently.

const BUTTON = 'px-2 py-1';
const ACTIVE = 'text-foreground';
const IDLE = 'hover:text-foreground';

export type TransportPickerProps = Readonly<{
  transport: DataPlaneTransport;
  setTransport: (value: DataPlaneTransport) => void;
  /** The negotiated ICE path — 'host'/'srflx' is direct, 'relay' is TURN. */
  path: string | null;
  /** Offer the TURN-forcing toggle (p2p only). */
  showForceRelay?: boolean;
  forceRelay?: boolean;
  setForceRelay?: (value: boolean) => void;
}>;

export const TransportPicker = ({
  transport,
  setTransport,
  path,
  showForceRelay = false,
  forceRelay = false,
  setForceRelay,
}: TransportPickerProps) => (
  <span className="border-border/60 hidden items-center rounded-md border lg:inline-flex">
    <button
      className={`${BUTTON} ${transport === 'relay' ? ACTIVE : IDLE}`}
      title="Bytes are relayed through the cloud gateway. Always works."
      type="button"
      onClick={() => {
        setTransport('relay');
      }}
    >
      relay
    </button>
    <button
      className={`${BUTTON} ${transport === 'p2p' ? ACTIVE : IDLE}`}
      title="Bytes go browser-to-device directly over WebRTC. No cloud bandwidth."
      type="button"
      onClick={() => {
        setTransport('p2p');
      }}
    >
      p2p
    </button>
    {transport === 'p2p' && showForceRelay ? (
      <button
        className={`border-border/60 border-l ${BUTTON} ${forceRelay ? ACTIVE : IDLE}`}
        title="Force the peer through the TURN relay, even when a direct path exists."
        type="button"
        onClick={() => {
          setForceRelay?.(!forceRelay);
        }}
      >
        turn
      </button>
    ) : null}
    {transport === 'p2p' && path !== null ? (
      <span
        className={`border-border/60 border-l font-mono ${BUTTON}`}
        title="The ICE candidate pair in use"
      >
        {path}
      </span>
    ) : null}
  </span>
);
