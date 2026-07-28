import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

type Status = "connecting" | "connected" | "disconnected";
type ThemeName = "Black" | "Dark" | "Light" | "White";

// GitHub-style ANSI palettes so TUIs render legibly on dark and light backgrounds.
const DARK_ANSI = {
  black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922",
  blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
  brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364",
  brightYellow: "#e3b341", brightBlue: "#79c0ff", brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd", brightWhite: "#f0f6fc",
};
const LIGHT_ANSI = {
  black: "#24292f", red: "#cf222e", green: "#116329", yellow: "#4d2d00",
  blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
  brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37",
  brightYellow: "#633c01", brightBlue: "#218bff", brightMagenta: "#a475f9",
  brightCyan: "#3192aa", brightWhite: "#8c959f",
};

// Order here is the dropdown order.
const THEMES: Record<ThemeName, ITheme> = {
  Black: { background: "#000000", foreground: "#e6e6e6", cursor: "#ffffff", cursorAccent: "#000000", selectionBackground: "#3a3d41", ...DARK_ANSI },
  Dark: { background: "#0b0f14", foreground: "#e6edf3", cursor: "#3fb950", cursorAccent: "#0b0f14", selectionBackground: "#284b63", ...DARK_ANSI },
  Light: { background: "#f6f8fa", foreground: "#1f2328", cursor: "#0969da", cursorAccent: "#ffffff", selectionBackground: "#b6d7ff", ...LIGHT_ANSI },
  White: { background: "#ffffff", foreground: "#1f2328", cursor: "#0969da", cursorAccent: "#ffffff", selectionBackground: "#b6d7ff", ...LIGHT_ANSI },
};

const MIN_FONT = 8;
const MAX_FONT = 30;
const DEFAULT_FONT = 14;
const DEFAULT_THEME: ThemeName = "Dark";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__shell_ws__`;

// Measured (experimental/bandwidth): EC2 egress ~1.065x payload; instance NIC ~2.13x (relay crosses the box twice).
const EGRESS_FACTOR = 1.065;
const INSTANCE_FACTOR = 2.13;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(2)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function fmtRate(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1048576).toFixed(1)} MB/s`;
}

export function App() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [nonce, setNonce] = useState(0); // bump to force reconnect

  const [fontSize, setFontSize] = useState<number>(() => {
    const v = Number(localStorage.getItem("helix.fontSize"));
    return v >= MIN_FONT && v <= MAX_FONT ? v : DEFAULT_FONT;
  });
  const [themeName, setThemeName] = useState<ThemeName>(() => {
    const v = localStorage.getItem("helix.theme") as ThemeName | null;
    return v && v in THEMES ? v : DEFAULT_THEME;
  });

  const bytesRef = useRef({ in: 0, out: 0 });
  const rateRef = useRef({ last: 0, t: 0 });
  const [stats, setStats] = useState({ in: 0, out: 0, rate: 0 });

  const connect = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    setStatus("connecting");
    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      fit.fit();
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      term.focus();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "exit") {
            term.write(`\r\n\x1b[33m[session exited: code ${msg.code}]\x1b[0m\r\n`);
          } else if (msg.type === "error") {
            term.write(`\r\n\x1b[31m[gateway: ${msg.message}]\x1b[0m\r\n`);
          }
        } catch {
          /* ignore */
        }
        return;
      }
      const buf = ev.data as ArrayBuffer;
      bytesRef.current.out += buf.byteLength;
      term.write(new Uint8Array(buf));
    };

    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("disconnected");
  }, []);

  useEffect(() => {
    if (!wrapRef.current || termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace',
      fontSize,
      theme: THEMES[themeName],
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(wrapRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const bytes = new TextEncoder().encode(data);
        bytesRef.current.in += bytes.length;
        ws.send(bytes);
      }
    });

    term.onResize(({ cols, rows }) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    // Coalesce resizes into one fit() per frame to avoid a synchronous refit storm.
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
        } catch {
          /* terminal not measurable yet */
        }
      });
    });
    ro.observe(wrapRef.current);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect, nonce]);

  useEffect(() => {
    const id = setInterval(() => {
      const { in: i, out: o } = bytesRef.current;
      const total = i + o;
      const now = performance.now();
      const prev = rateRef.current;
      const dt = prev.t ? (now - prev.t) / 1000 : 0;
      const rate = dt > 0 ? Math.max(0, (total - prev.last) / dt) : 0;
      rateRef.current = { last: total, t: now };
      setStats({ in: i, out: o, rate });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    requestAnimationFrame(() => fitRef.current?.fit());
    localStorage.setItem("helix.fontSize", String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = THEMES[themeName];
    localStorage.setItem("helix.theme", themeName);
  }, [themeName]);

  const resetAppearance = () => {
    setFontSize(DEFAULT_FONT);
    setThemeName(DEFAULT_THEME);
  };

  const total = stats.in + stats.out;
  const statsTitle =
    `session payload:  down ${fmtBytes(stats.out)} · up ${fmtBytes(stats.in)} · total ${fmtBytes(total)}\n` +
    `EC2 egress ≈ ${fmtBytes(total * EGRESS_FACTOR)}  (×${EGRESS_FACTOR}, TLS/framing)\n` +
    `instance NIC ≈ ${fmtBytes(total * INSTANCE_FACTOR)}  (×${INSTANCE_FACTOR}, relay both legs)`;

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">
          <span className="accent">helix</span> device shell
        </span>
        <span className="host">{location.host}</span>
        <span className="warn">· experimental · no auth</span>
        <span className="spacer" />
        <span className="ctl">
          <span className="ctl-label">Font size</span>
          <button
            className="stepper"
            title="Decrease font size"
            onClick={() => setFontSize((f) => Math.max(MIN_FONT, f - 1))}
          >
            −
          </button>
          <span className="ctl-val">{fontSize}</span>
          <button
            className="stepper"
            title="Increase font size"
            onClick={() => setFontSize((f) => Math.min(MAX_FONT, f + 1))}
          >
            +
          </button>
        </span>
        <span className="ctl">
          <span className="ctl-label">Appearance</span>
          <select
            className="select"
            value={themeName}
            onChange={(e) => setThemeName(e.target.value as ThemeName)}
          >
            {(Object.keys(THEMES) as ThemeName[]).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
        <button className="reset" onClick={resetAppearance}>
          Reset
        </button>
        <span className="stats" title={statsTitle}>
          <span className="down" title="PTY output received">↓ {fmtBytes(stats.out)}</span>
          <span className="up" title="keystrokes sent">↑ {fmtBytes(stats.in)}</span>
          <span className="rate">{fmtRate(stats.rate)}</span>
          <span className="egress" title="estimated EC2 egress (billable)">
            egress≈{fmtBytes(total * EGRESS_FACTOR)}
          </span>
        </span>
        <span className="status">
          <span className={`dot ${status}`} />
          {status}
        </span>
        {status !== "connected" && (
          <button className="reconnect" onClick={() => setNonce((n) => n + 1)}>
            Reconnect
          </button>
        )}
      </div>
      <div
        className="terminal-wrap"
        ref={wrapRef}
        style={{ background: THEMES[themeName].background }}
      />
    </div>
  );
}
