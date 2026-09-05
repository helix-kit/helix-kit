'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@helix-hq/design-system/components/button';
import { Input } from '@helix-hq/design-system/components/input';
import { Label } from '@helix-hq/design-system/components/label';
import { useMqttGatewayTransport } from '@helix-hq/protocol/mqtt/react';
import { useTypedDeviceService } from '@helix-hq/protocol/service/react';
import { Expand, Keyboard, Play, ScanEye } from 'lucide-react';

import { createNovncTransport } from './novnc-transport';
import { loadRFB, type RFBInstance } from './rfb';

import {
  openPeerChannel,
  openRelayChannel,
  TransportPicker,
  useDataPlaneSession,
  type DeviceChannel,
  type SessionService,
} from '../data-plane';
import { HeaderPortal } from '../header-portal';
import { portForwardControlContract } from '../linux-port-forward/contract';

const OPEN_TIMEOUT_MS = 30_000;
// The device dials the VNC target only once the browser opens a stream, so a slow
// dial can close the first attach; retry a few times before calling it failed.
const ATTACH_RETRY_MS = 600;
const ATTACH_MAX_ATTEMPTS = 10;
const STATS_INTERVAL_MS = 1_000;
const BYTES_PER_KB = 1_024;
const BYTES_PER_MB = 1_048_576;

const DEFAULT_TARGET = '127.0.0.1:5909';
const TARGET_KEY = 'helix.remote-desktop.target';

type Status = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

const fmtBytes = (n: number): string => {
  if (n < BYTES_PER_KB) return `${n} B`;
  if (n < BYTES_PER_MB) return `${(n / BYTES_PER_KB).toFixed(1)} KB`;
  return `${(n / BYTES_PER_MB).toFixed(2)} MB`;
};

const statusDotClass = (status: Status): string => {
  if (status === 'connected') return 'bg-emerald-500';
  if (status === 'connecting') return 'bg-amber-500';
  if (status === 'idle') return 'bg-muted-foreground';
  return 'bg-destructive';
};

const readTarget = (): string => {
  if (typeof window === 'undefined') return DEFAULT_TARGET;
  return window.localStorage.getItem(TARGET_KEY) ?? DEFAULT_TARGET;
};

export type RemoteDesktopProps = Readonly<{
  clientStreamUrl: string;
  deviceStreamUrl: string;
}>;

// The remote-desktop viewer: control over the typed port-forward service, RFB bytes
// over the data plane. The device runs a stock VNC server — it needs no Helix code
// beyond allow-listing the target. Must render inside <MqttGatewayProvider>.
export const RemoteDesktop = ({ clientStreamUrl, deviceStreamUrl }: RemoteDesktopProps) => {
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFBInstance | null>(null);
  const channelRef = useRef<DeviceChannel | null>(null);
  const attachRef = useRef<((sessionId: string, attempt: number) => void) | null>(null);
  const bytesRef = useRef({ in: 0, out: 0 });

  const mqtt = useMqttGatewayTransport();
  const pf = useTypedDeviceService(portForwardControlContract, { timeoutMs: OPEN_TIMEOUT_MS });

  const [target, setTarget] = useState(readTarget);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [desktopName, setDesktopName] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [scaled, setScaled] = useState(true);
  const [stats, setStats] = useState({ in: 0, out: 0 });

  const teardownViewer = useCallback(() => {
    rfbRef.current?.disconnect();
    rfbRef.current = null;
    channelRef.current?.close();
    channelRef.current = null;
  }, []);

  const session = useDataPlaneSession({
    service: pf as unknown as SessionService,
    isConnected: pf.isConnected,
    deviceStreamUrl,
    failureTag: 'helix-port-forward',
    ready: started,
    params: { target: target.trim() },
    onOpen: (opened) => {
      attachRef.current?.(opened.sessionId, 0);
    },
    onError: (message) => {
      setStatus('error');
      setDetail(message);
    },
    onTeardown: () => {
      teardownViewer();
      setStatus(started ? 'connecting' : 'idle');
      setDesktopName(null);
      setDetail(null);
    },
  });

  const { current: currentSession, reconnect } = session;

  // Attach a viewer to the session's data plane. Identical for both transports —
  // that is the point of DeviceChannel.
  const attachViewer = useCallback(
    (sessionId: string, attempt: number): void => {
      const screen = screenRef.current;
      if (screen === null) {
        return;
      }
      setStatus('connecting');
      let opened = false;

      const transport = createNovncTransport({
        onBytesIn: (n) => {
          bytesRef.current.in += n;
        },
        onBytesOut: (n) => {
          bytesRef.current.out += n;
        },
      });

      const wrapped = {
        ...transport.handlers,
        onOpen: () => {
          opened = true;
          transport.handlers.onOpen();
        },
        onClose: () => {
          transport.handlers.onClose();
          if (currentSession().sessionId !== sessionId) {
            return;
          }
          // Nothing ever arrived: the device's dial to the VNC target probably lost
          // the race, so re-attach rather than declaring the desktop dead.
          if (!opened && attempt < ATTACH_MAX_ATTEMPTS) {
            setTimeout(() => attachRef.current?.(sessionId, attempt + 1), ATTACH_RETRY_MS);
          }
        },
      };

      void (async () => {
        const RFBClass = await loadRFB();
        if (currentSession().sessionId !== sessionId) {
          return;
        }

        // RFB must be constructed before the channel opens: attach() installs the
        // handlers the open event fires.
        const rfb = new RFBClass(screen, transport.channel, { shared: true });
        rfb.viewOnly = viewOnly;
        rfb.scaleViewport = scaled;
        rfb.background = 'transparent';
        rfb.addEventListener('connect', () => {
          setStatus('connected');
          setDetail(null);
          rfb.focus();
        });
        rfb.addEventListener('disconnect', (event) => {
          const { clean } = (event as CustomEvent<{ clean: boolean }>).detail;
          setStatus(clean ? 'closed' : 'error');
          if (!clean) {
            setDetail('the VNC connection dropped');
          }
        });
        rfb.addEventListener('desktopname', (event) => {
          setDesktopName((event as CustomEvent<{ name: string }>).detail.name);
        });
        rfb.addEventListener('securityfailure', (event) => {
          const { reason } = (event as CustomEvent<{ reason?: string }>).detail;
          setStatus('error');
          setDetail(reason ?? 'VNC security handshake failed');
        });
        rfbRef.current = rfb;

        const { peerSession } = currentSession();
        const channel =
          peerSession === null
            ? openRelayChannel(clientStreamUrl, sessionId, '', wrapped)
            : openPeerChannel(peerSession, '', wrapped);
        transport.setChannel(channel);
        channelRef.current = channel;
      })();
    },
    [clientStreamUrl, currentSession, scaled, viewOnly],
  );

  useEffect(() => {
    attachRef.current = attachViewer;
  }, [attachViewer]);

  useEffect(() => {
    if (rfbRef.current !== null) {
      rfbRef.current.viewOnly = viewOnly;
    }
  }, [viewOnly]);

  useEffect(() => {
    if (rfbRef.current !== null) {
      rfbRef.current.scaleViewport = scaled;
    }
  }, [scaled]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStats({ in: bytesRef.current.in, out: bytesRef.current.out });
    }, STATS_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    void mqtt.connect();
    return teardownViewer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(() => {
    window.localStorage.setItem(TARGET_KEY, target.trim());
    setStarted(true);
    setStatus('connecting');
  }, [target]);

  const fullscreen = useCallback(() => {
    void screenRef.current?.requestFullscreen();
  }, []);

  if (!started) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="grid w-full max-w-md gap-3">
          <div className="grid gap-1">
            <h2 className="text-base font-medium">Remote desktop</h2>
            <p className="text-muted-foreground text-sm">
              Connects to a VNC server on the device over the Helix data plane. The device must
              allow the target in its port-forward config.
            </p>
          </div>
          <Label htmlFor="rd-target">VNC target (host:port on the device)</Label>
          <div className="flex gap-2">
            <Input
              className="font-mono"
              id="rd-target"
              placeholder={DEFAULT_TARGET}
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
              }}
            />
            <Button disabled={target.trim() === ''} onClick={start}>
              <Play />
              Connect
            </Button>
          </div>
          {session.error === null ? null : (
            <p className="text-destructive text-xs">{session.error}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <HeaderPortal>
        <div className="text-muted-foreground flex items-center gap-3 text-xs">
          <TransportPicker
            forceRelay={session.forceRelay}
            path={session.icePath}
            setForceRelay={session.setForceRelay}
            setTransport={session.setTransport}
            showForceRelay
            transport={session.transport}
          />
          <span className="hidden items-center gap-2 tabular-nums md:flex">
            <span title="framebuffer bytes received">↓ {fmtBytes(stats.in)}</span>
            <span title="input bytes sent">↑ {fmtBytes(stats.out)}</span>
          </span>
          <span className="border-border/60 hidden items-center rounded-md border lg:inline-flex">
            <button
              className={`px-2 py-1 ${viewOnly ? 'text-foreground' : 'hover:text-foreground'}`}
              title="Ignore mouse and keyboard input"
              type="button"
              onClick={() => {
                setViewOnly((value) => !value);
              }}
            >
              <ScanEye className="size-3.5" />
            </button>
            <button
              className={`border-border/60 border-l px-2 py-1 ${scaled ? 'text-foreground' : 'hover:text-foreground'}`}
              title="Scale the desktop to fit"
              type="button"
              onClick={() => {
                setScaled((value) => !value);
              }}
            >
              <Expand className="size-3.5" />
            </button>
            <button
              className="border-border/60 hover:text-foreground border-l px-2 py-1"
              title="Send Ctrl+Alt+Del"
              type="button"
              onClick={() => {
                rfbRef.current?.sendCtrlAltDel();
              }}
            >
              <Keyboard className="size-3.5" />
            </button>
          </span>
          <button
            className="hover:text-foreground hidden sm:block"
            title="Fullscreen"
            type="button"
            onClick={fullscreen}
          >
            <Expand className="size-3.5" />
          </button>
          <span className="flex items-center gap-1.5">
            <span className={`inline-block size-2 rounded-full ${statusDotClass(status)}`} />
            <span className="capitalize">{status}</span>
            {desktopName === null ? null : (
              <span className="hidden xl:inline">· {desktopName}</span>
            )}
            {detail === null ? null : <span className="text-destructive">· {detail}</span>}
            {status === 'closed' || status === 'error' ? (
              <button
                className="text-foreground hover:text-brand underline underline-offset-2"
                type="button"
                onClick={reconnect}
              >
                Reconnect
              </button>
            ) : null}
          </span>
        </div>
      </HeaderPortal>
      <div ref={screenRef} className="bg-muted/30 h-full w-full" />
    </>
  );
};
