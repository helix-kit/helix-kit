'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@helix/design-system/components/popover';
import { selectedCandidatePair } from '@helix/protocol-peer';
import { method, type ServiceContract } from '@helix/protocol-service';
import { useTypedDeviceService, useTypedDeviceServiceQuery } from '@helix/protocol-service/react';
import { useMqttGatewayTransport } from '@helix/transport-mqtt/react';
import { Minus, Monitor, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import { z } from 'zod';

import type { HelixStreamSession } from '@helix/protocol-stream';
import type { FitAddon as XFitAddon } from '@xterm/addon-fit';
import type { ITheme, Terminal as XTerminal } from '@xterm/xterm';

import {
  openFailureMessage,
  openPeerChannel,
  openRelayChannel,
  openSession,
  useIceServers,
  type DataPlaneTransport,
  type DeviceChannel,
  type SessionService,
} from '../data-plane';
import { HeaderPortal } from '../header-portal';
import { formatAge, shortId, useNow } from '../session-format';

import '@xterm/xterm/css/xterm.css';
import './terminal.css';

// The device has its own 15s budget to dial the data plane (dataplane.dialTimeout),
// so a browser timeout at 15s can expire while the device is still succeeding —
// which surfaced as "No response from the device" against a log line saying
// `session opened`. Stay clear of the device's own budget plus a round trip.
const OPEN_TIMEOUT_MS = 30_000;
// Generous client-attach window (~12s): a slow ESP32 bridge's mTLS dial races the
// attach and lands in "closed" if the retry budget is too tight.
const CLIENT_RETRY_MS = 600;
const CLIENT_MAX_ATTEMPTS = 20;
const LIST_POLL_MS = 4000;
const STATS_INTERVAL_MS = 1_000;
const MS_PER_SECOND = 1_000;

const RTT_WINDOW = 20; // rolling keystroke-echo samples to median over
const RTT_STALE_MS = 3_000; // ignore an "echo" arriving this long after a keystroke

const MIN_FONT = 8;
const MAX_FONT = 30;
const DEFAULT_FONT = 14;
const DEFAULT_THEME: ThemeName = 'Dark';

const sessionInfoSchema = z.object({
  sessionId: z.string(),
  createdAt: z.number().int(),
  terminals: z.number().int(),
});
type SessionInfo = z.infer<typeof sessionInfoSchema>;

const _terminalContract = {
  service: 'stream',
  methods: {
    open: method({
      name: 'open',
      input: z.object({ sessionId: z.string() }),
      output: z.object({ sessionId: z.string() }),
    }),
    close: method({
      name: 'close',
      input: z.object({ sessionId: z.string() }),
      output: z.object({ sessionId: z.string() }),
    }),
    list: method({
      name: 'list',
      input: z.object({}),
      output: z.object({ sessions: z.array(sessionInfoSchema) }),
    }),
  },
} satisfies ServiceContract;
type TerminalContract = typeof _terminalContract;

type Status = 'connecting' | 'opening' | 'connected' | 'closed' | 'error';
type ThemeName = 'Black' | 'Dark' | 'Light' | 'White';

// GitHub-style ANSI palettes so TUIs render legibly on dark and light backgrounds.
const DARK_ANSI = {
  black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
  blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
  brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
}; // prettier-ignore
const LIGHT_ANSI = {
  black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00',
  blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
  brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37',
  brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9',
  brightCyan: '#3192aa', brightWhite: '#8c959f',
}; // prettier-ignore

const THEMES: Record<ThemeName, ITheme> = {
  Black: { background: '#000000', foreground: '#e6e6e6', cursor: '#ffffff', cursorAccent: '#000000', selectionBackground: '#3a3d41', ...DARK_ANSI },
  Dark: { background: '#0b0f14', foreground: '#e6edf3', cursor: '#3fb950', cursorAccent: '#0b0f14', selectionBackground: '#284b63', ...DARK_ANSI },
  Light: { background: '#f6f8fa', foreground: '#1f2328', cursor: '#0969da', cursorAccent: '#ffffff', selectionBackground: '#b6d7ff', ...LIGHT_ANSI },
  White: { background: '#ffffff', foreground: '#1f2328', cursor: '#0969da', cursorAccent: '#ffffff', selectionBackground: '#b6d7ff', ...LIGHT_ANSI },
}; // prettier-ignore

const BYTES_PER_KB = 1_024;
const BYTES_PER_MB = 1_048_576;
const BYTES_PER_GB = 1_073_741_824;

const fmtBytes = (n: number): string => {
  if (n < BYTES_PER_KB) return `${n} B`;
  if (n < BYTES_PER_MB) return `${(n / BYTES_PER_KB).toFixed(1)} KB`;
  if (n < BYTES_PER_GB) return `${(n / BYTES_PER_MB).toFixed(2)} MB`;
  return `${(n / BYTES_PER_GB).toFixed(2)} GB`;
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? hi) + hi) / 2;
  }
  return hi;
};

const readNumber = (key: string, fallback: number, min: number, max: number): number => {
  if (typeof window === 'undefined') return fallback;
  const value = Number(window.localStorage.getItem(key));
  return value >= min && value <= max ? value : fallback;
};

const readTheme = (key: string): ThemeName => {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const value = window.localStorage.getItem(key) as ThemeName | null;
  return value !== null && value in THEMES ? value : DEFAULT_THEME;
};

const statusDotClass = (status: Status): string => {
  if (status === 'connected') {
    return 'bg-emerald-500';
  }
  if (status === 'connecting' || status === 'opening') {
    return 'bg-amber-500';
  }
  return 'bg-destructive';
};

type SessionsProps = {
  sessions: readonly SessionInfo[];
  label: string;
  currentSessionId: string | null;
  fetching: boolean;
  refresh: () => void;
  close: (sessionId: string) => void;
};

const SessionsPopover = ({
  sessions,
  label,
  currentSessionId,
  fetching,
  refresh,
  close,
}: SessionsProps) => {
  const now = useNow();
  const ordered = [...sessions].sort((a, b) => a.createdAt - b.createdAt);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="border-border/60 hover:text-foreground inline-flex items-center gap-1.5 rounded-md border px-2 py-1"
          type="button"
        >
          <Monitor className="size-3.5" />
          <span className="tabular-nums">{sessions.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="text-muted-foreground flex items-center justify-between border-b px-3 py-2 text-xs">
          <span>
            {label} ({sessions.length})
          </span>
          <button
            aria-label="Refresh sessions"
            className="hover:text-foreground inline-flex items-center"
            type="button"
            onClick={refresh}
          >
            <RefreshCw className={`size-3.5 ${fetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {ordered.length === 0 ? (
          <p className="text-muted-foreground px-3 py-3 text-sm">No open sessions.</p>
        ) : (
          <ul className="max-h-72 overflow-auto">
            {ordered.map((session) => {
              const isCurrent = session.sessionId === currentSessionId;
              return (
                <li
                  key={session.sessionId}
                  className="hover:bg-muted/50 flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="grid min-w-0 gap-0.5">
                    <span className="text-foreground flex items-center gap-1.5 font-mono text-xs">
                      {shortId(session.sessionId)}
                      {isCurrent ? <span className="text-brand not-italic">· this tab</span> : null}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {session.terminals} {session.terminals === 1 ? 'terminal' : 'terminals'} · up{' '}
                      {formatAge(session.createdAt, now)}
                    </span>
                  </div>
                  <button
                    aria-label="Close session"
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    title={isCurrent ? 'Close this session' : 'Close session'}
                    type="button"
                    onClick={() => {
                      close(session.sessionId);
                    }}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
};

type TransportProps = {
  transport: DataPlaneTransport;
  setTransport: (value: DataPlaneTransport) => void;
  forceRelay: boolean;
  setForceRelay: (value: boolean) => void;
  /** The negotiated ICE path — 'host'/'srflx' is direct, 'relay' is TURN. */
  path: string | null;
};

const PICKER_BUTTON = 'px-2 py-1';
const PICKER_ACTIVE = 'text-foreground';
const PICKER_IDLE = 'hover:text-foreground';

const TransportPicker = ({
  transport,
  setTransport,
  forceRelay,
  setForceRelay,
  path,
}: TransportProps) => (
  <span className="border-border/60 hidden items-center rounded-md border lg:inline-flex">
    <button
      className={`${PICKER_BUTTON} ${transport === 'relay' ? PICKER_ACTIVE : PICKER_IDLE}`}
      title="Bytes are relayed through the cloud gateway. Always works."
      type="button"
      onClick={() => {
        setTransport('relay');
      }}
    >
      relay
    </button>
    <button
      className={`${PICKER_BUTTON} ${transport === 'p2p' ? PICKER_ACTIVE : PICKER_IDLE}`}
      title="Bytes go browser-to-device directly over WebRTC. No cloud bandwidth."
      type="button"
      onClick={() => {
        setTransport('p2p');
      }}
    >
      p2p
    </button>
    {transport === 'p2p' ? (
      <>
        <button
          className={`border-border/60 border-l ${PICKER_BUTTON} ${
            forceRelay ? PICKER_ACTIVE : PICKER_IDLE
          }`}
          title="Force the peer through the TURN relay, even when a direct path exists."
          type="button"
          onClick={() => {
            setForceRelay(!forceRelay);
          }}
        >
          turn
        </button>
        {path === null ? null : (
          <span
            className={`border-border/60 border-l font-mono ${PICKER_BUTTON}`}
            title="The ICE candidate pair in use"
          >
            {path}
          </span>
        )}
      </>
    ) : null}
  </span>
);

type ControlsProps = {
  status: Status;
  detail: string | null;
  stats: { inBytes: number; outBytes: number; rate: number; rtt: number | null };
  fontSize: number;
  setFontSize: (update: (value: number) => number) => void;
  themeName: ThemeName;
  setThemeName: (value: ThemeName) => void;
  reset: () => void;
  reconnect: () => void;
  sessions: SessionsProps;
  transport: TransportProps;
  p2pEnabled: boolean;
};

const StreamControls = ({
  status,
  detail,
  stats,
  fontSize,
  setFontSize,
  themeName,
  setThemeName,
  reset,
  reconnect,
  sessions,
  transport,
  p2pEnabled,
}: ControlsProps) => {
  const dot = statusDotClass(status);
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      <SessionsPopover {...sessions} />
      {p2pEnabled ? <TransportPicker {...transport} /> : null}
      <span className="hidden items-center gap-2 tabular-nums md:flex">
        <span title="PTY output received">↓ {fmtBytes(stats.outBytes)}</span>
        <span title="keystrokes sent">↑ {fmtBytes(stats.inBytes)}</span>
        {stats.rtt === null ? null : (
          <span title="keystroke round-trip latency (echo)">⟳ {Math.round(stats.rtt)} ms</span>
        )}
      </span>
      <span className="border-border/60 hidden items-center rounded-md border sm:inline-flex">
        <button
          aria-label="Decrease font size"
          className="hover:text-foreground px-1.5 py-1"
          type="button"
          onClick={() => {
            setFontSize((value) => Math.max(MIN_FONT, value - 1));
          }}
        >
          <Minus className="size-3.5" />
        </button>
        <span className="w-5 text-center tabular-nums">{fontSize}</span>
        <button
          aria-label="Increase font size"
          className="hover:text-foreground px-1.5 py-1"
          type="button"
          onClick={() => {
            setFontSize((value) => Math.min(MAX_FONT, value + 1));
          }}
        >
          <Plus className="size-3.5" />
        </button>
      </span>
      <select
        aria-label="Terminal appearance"
        className="border-border/60 bg-background hidden h-7 rounded-md border px-2 text-xs sm:block"
        value={themeName}
        onChange={(event) => {
          setThemeName(event.target.value as ThemeName);
        }}
      >
        {(Object.keys(THEMES) as ThemeName[]).map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <button
        aria-label="Reset appearance"
        className="hover:text-foreground hidden sm:block"
        type="button"
        onClick={reset}
      >
        <RotateCcw className="size-3.5" />
      </button>
      <span className="flex items-center gap-1.5">
        <span className={`inline-block size-2 rounded-full ${dot}`} />
        <span className="capitalize">{status}</span>
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
  );
};

// The interactive terminal: control over the typed MQTT service, bytes over the
// data plane. Must be rendered inside <MqttGatewayProvider>.
export type StreamTerminalProps = {
  clientStreamUrl: string;
  deviceStreamUrl: string;
  /** The device service contract driving open/close/list (shell or console). */
  contract: ServiceContract;
  /** Whether to offer the P2P transport. UART/console is relay-only. */
  p2pEnabled?: boolean;
  /** localStorage namespace for font/theme prefs, e.g. 'shell' | 'uart-console'. */
  storageNamespace: string;
  /** Header label for the sessions popover, e.g. 'Shell sessions'. */
  sessionsLabel: string;
  /** Tag used in open-failure diagnostics, e.g. 'helix-shell'. */
  failureTag: string;
};

export const StreamTerminal = ({
  clientStreamUrl,
  deviceStreamUrl,
  contract,
  p2pEnabled = true,
  storageNamespace,
  sessionsLabel,
  failureTag,
}: StreamTerminalProps) => {
  const fontKey = `helix.${storageNamespace}.fontSize`;
  const themeKey = `helix.${storageNamespace}.theme`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const channelRef = useRef<DeviceChannel | null>(null);
  const peerSessionRef = useRef<HelixStreamSession | null>(null);
  const closeSessionRef = useRef<(() => void) | null>(null);
  const attachRef = useRef<((sessionId: string, attempt: number) => void) | null>(null);
  const sessionRef = useRef<string | null>(null);
  const bytesRef = useRef({ inBytes: 0, outBytes: 0 });
  const rateRef = useRef({ last: 0, at: 0 });
  const rttRef = useRef<{ sentAt: number | null; samples: number[] }>({
    sentAt: null,
    samples: [],
  });

  const mqtt = useMqttGatewayTransport();
  const shell = useTypedDeviceService(contract as unknown as TerminalContract, {
    timeoutMs: OPEN_TIMEOUT_MS,
  });
  const sessionsQuery = useTypedDeviceServiceQuery(
    shell,
    'list',
    {},
    {
      refetchInterval: LIST_POLL_MS,
    },
  );

  const [status, setStatus] = useState<Status>('connecting');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [termReady, setTermReady] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [fontSize, setFontSize] = useState(() =>
    readNumber(fontKey, DEFAULT_FONT, MIN_FONT, MAX_FONT),
  );
  const [themeName, setThemeName] = useState<ThemeName>(() => readTheme(themeKey));
  const [stats, setStats] = useState<{
    inBytes: number;
    outBytes: number;
    rate: number;
    rtt: number | null;
  }>({ inBytes: 0, outBytes: 0, rate: 0, rtt: null });

  const [transport, setTransport] = useState<DataPlaneTransport>('relay');
  const [icePath, setIcePath] = useState<string | null>(null);

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
  const [forceRelay, setForceRelay] = useState(false);
  // ICE servers must be in hand before opening: they are passed to the device in the
  // `open` command, and a device that gathers no candidates can only fail to connect.
  const { iceServers, isLoading: iceLoading } = useIceServers(transport === 'p2p');

  // Attach the terminal to the session's data plane; identical for both transports,
  // which is the point of DeviceChannel.
  const attachClient = useCallback(
    (sessionId: string, attempt: number): void => {
      const term = termRef.current;
      if (term === null) {
        return;
      }
      const meta = JSON.stringify({ cols: term.cols, rows: term.rows });
      let opened = false;

      const handlers = {
        onOpen: () => {
          opened = true;
          setStatus('connected');
          setDetail(null);
          fitRef.current?.fit();
          channelRef.current?.signal(
            JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }),
          );
          term.focus();
        },
        onData: (data: Uint8Array) => {
          bytesRef.current.outBytes += data.byteLength;
          // The first bytes back after a keystroke are its echo — sample the RTT.
          const { sentAt } = rttRef.current;
          if (sentAt !== null) {
            rttRef.current.sentAt = null;
            const dt = performance.now() - sentAt;
            if (dt < RTT_STALE_MS) {
              const { samples } = rttRef.current;
              samples.push(dt);
              if (samples.length > RTT_WINDOW) {
                samples.shift();
              }
            }
          }
          term.write(data);
        },
        onClose: () => {
          if (sessionRef.current !== sessionId) {
            return;
          }
          if (!opened && attempt < CLIENT_MAX_ATTEMPTS) {
            // Re-enter through the ref: a useCallback can't reference its own binding.
            setTimeout(() => attachRef.current?.(sessionId, attempt + 1), CLIENT_RETRY_MS);
            return;
          }
          setStatus('closed');
        },
        onError: () => {
          /* onClose follows and owns the retry/teardown decision */
        },
      };

      const peerSession = peerSessionRef.current;
      channelRef.current =
        peerSession === null
          ? openRelayChannel(clientStreamUrl, sessionId, meta, handlers)
          : openPeerChannel(peerSession, meta, handlers);
    },
    [clientStreamUrl],
  );

  useEffect(() => {
    attachRef.current = attachClient;
  }, [attachClient]);

  // Create the terminal once; xterm is imported dynamically because its addons
  // touch `self` at eval time and would crash server rendering.
  useEffect(() => {
    // An object, not a `let`: TS would narrow a boolean `let` to `false` here (the
    // cleanup that flips it runs in a closure flow analysis can't see).
    const lifecycle = { disposed: false };
    let observer: ResizeObserver | null = null;
    let raf = 0;
    void (async () => {
      if (termRef.current !== null) {
        return;
      }
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      const wrap = wrapRef.current;
      if (lifecycle.disposed || wrap === null) {
        return;
      }
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace',
        fontSize,
        theme: THEMES[themeName],
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(wrap);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      term.onData((data) => {
        const bytes = new TextEncoder().encode(data);
        bytesRef.current.inBytes += bytes.length;
        // Start an RTT probe on a lone keystroke (skip pastes / one already pending).
        if (bytes.length <= 2 && rttRef.current.sentAt === null) {
          rttRef.current.sentAt = performance.now();
        }
        void channelRef.current?.send(bytes);
      });
      term.onResize(({ cols, rows }) => {
        channelRef.current?.signal(JSON.stringify({ type: 'resize', cols, rows }));
      });

      const refit = (): void => {
        try {
          fitRef.current?.fit();
        } catch {
          /* not measurable yet */
        }
      };
      observer = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(refit);
      });
      observer.observe(wrap);
      setTermReady(true);
    })();
    return () => {
      lifecycle.disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (term === null) {
      return;
    }
    term.options.fontSize = fontSize;
    requestAnimationFrame(() => fitRef.current?.fit());
    window.localStorage.setItem(fontKey, String(fontSize));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize]);

  useEffect(() => {
    if (termRef.current !== null) {
      termRef.current.options.theme = THEMES[themeName];
    }
    window.localStorage.setItem(themeKey, themeName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeName]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const { inBytes, outBytes } = bytesRef.current;
      const total = inBytes + outBytes;
      const now = performance.now();
      const prev = rateRef.current;
      const dt = prev.at === 0 ? 0 : (now - prev.at) / MS_PER_SECOND;
      const rate = dt > 0 ? Math.max(0, (total - prev.last) / dt) : 0;
      rateRef.current = { last: total, at: now };
      const { samples } = rttRef.current;
      setStats({ inBytes, outBytes, rate, rtt: samples.length > 0 ? median(samples) : null });
    }, STATS_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    void mqtt.connect();
    return () => {
      channelRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  useEffect(() => {
    if (
      !shell.isConnected ||
      !termReady ||
      sessionRef.current !== null ||
      termRef.current === null
    ) {
      return;
    }
    if (transport === 'p2p' && iceLoading) {
      return; // opening without ICE servers is a guaranteed failure
    }
    const sessionId = crypto.randomUUID();
    sessionRef.current = sessionId;
    void openSession({
      service: shell as unknown as SessionService,
      sessionId,
      transport,
      deviceStreamUrl,
      iceServers,
      ...(transport === 'p2p' && forceRelay ? { iceTransportPolicy: 'relay' as const } : {}),
    })
      .then((session) => {
        // Bail if the user reconnected or switched transport while we negotiated.
        if (sessionRef.current !== sessionId) {
          session.close();
          return undefined;
        }
        peerSessionRef.current = session.peerSession;
        closeSessionRef.current = session.close;
        setCurrentSessionId(sessionId);
        attachClient(sessionId, 0);
        reportIcePath(session.connection);
        return shell.invalidateQueries('list', {});
      })
      .catch((error: unknown) => {
        if (sessionRef.current !== sessionId) {
          return;
        }
        setStatus('error');
        setDetail(openFailureMessage(error, failureTag));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shell.isConnected,
    termReady,
    deviceStreamUrl,
    nonce,
    transport,
    forceRelay,
    iceServers,
    iceLoading,
  ]);

  const reconnect = useCallback(() => {
    channelRef.current?.close();
    channelRef.current = null;
    closeSessionRef.current?.();
    closeSessionRef.current = null;
    peerSessionRef.current = null;
    sessionRef.current = null;
    setIcePath(null);
    setCurrentSessionId(null);
    setStatus('connecting');
    setDetail(null);
    setNonce((value) => value + 1);
  }, []);

  const closeSession = useCallback(
    (sessionId: string) => {
      // Closing our own session: drop the terminal too, so the UI doesn't sit
      // "connected" against a stream the device just tore down.
      if (sessionId === sessionRef.current) {
        reconnect();
      }
      void shell
        .request('close', { sessionId })
        .catch(() => {
          /* the session is torn down regardless */
        })
        .finally(() => void shell.invalidateQueries('list', {}));
    },
    [shell, reconnect],
  );

  const reset = useCallback(() => {
    setFontSize(() => DEFAULT_FONT);
    setThemeName(DEFAULT_THEME);
  }, []);

  return (
    <>
      <HeaderPortal>
        <StreamControls
          detail={detail}
          fontSize={fontSize}
          p2pEnabled={p2pEnabled}
          reconnect={reconnect}
          reset={reset}
          sessions={{
            sessions: sessionsQuery.data?.sessions ?? [],
            label: sessionsLabel,
            currentSessionId,
            fetching: sessionsQuery.isFetching,
            refresh: () => void shell.invalidateQueries('list', {}),
            close: closeSession,
          }}
          setFontSize={setFontSize}
          setThemeName={setThemeName}
          stats={stats}
          status={status}
          themeName={themeName}
          transport={{
            transport,
            setTransport: (value) => {
              setTransport(value);
              reconnect();
            },
            forceRelay,
            setForceRelay: (value) => {
              setForceRelay(value);
              reconnect();
            },
            path: icePath,
          }}
        />
      </HeaderPortal>
      <div
        ref={wrapRef}
        className="h-full w-full p-2"
        style={{ background: THEMES[themeName].background }}
      />
    </>
  );
};
