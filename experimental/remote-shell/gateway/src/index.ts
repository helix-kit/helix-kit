// Helix remote-shell gateway (experimental).
//
// Served at helix-kit.com (behind Caddy). Responsibilities:
//   - serve the React terminal UI (static files)
//   - /__shell_agent__  : device agent control channel (one agent, MVP)
//   - /__shell_ws__     : browser terminal sockets, relayed to the agent PTY
//
// WARNING (experimental): NO auth. Anyone reaching the UI gets a device shell.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Frame, decodeFrame, encodeFrame, encodeJson } from "./protocol.js";

const PORT = Number(process.env.PORT ?? 9100);
const STATIC_DIR = process.env.STATIC_DIR ?? path.resolve("public");

// ---------------------------------------------------------------------------
// Single connected device agent (MVP). Browser terminals are multiplexed over
// its one WebSocket by stream id.
// ---------------------------------------------------------------------------

interface Terminal {
  onData(payload: Buffer): void;
  onExit(code: number): void;
}

class DeviceAgent {
  private nextStreamId = 1;
  private readonly terminals = new Map<number, Terminal>();

  // Application-payload byte counters (plaintext, pre-TLS):
  //   out = PTY output bytes relayed device -> browser (the shell "download")
  //   in  = keystroke bytes relayed browser -> device
  bytesOut = 0;
  bytesIn = 0;
  readonly connectedAt = Date.now();

  constructor(
    public readonly ws: WebSocket,
    public readonly agentId: string,
  ) {}

  get terminalCount(): number {
    return this.terminals.size;
  }

  openTerminal(t: Terminal): number {
    const id = this.nextStreamId++;
    this.terminals.set(id, t);
    return id;
  }

  closeTerminal(id: number): void {
    this.terminals.delete(id);
  }

  send(type: Frame, streamId: number, payload?: Buffer): void {
    if (payload && type === Frame.DATA) this.bytesIn += payload.length; // stdin
    if (this.ws.readyState === WebSocket.OPEN)
      this.ws.send(encodeFrame(type, streamId, payload));
  }

  sendJson(type: Frame, streamId: number, obj: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN)
      this.ws.send(encodeJson(type, streamId, obj));
  }

  dispatch(type: Frame, streamId: number, payload: Buffer): void {
    const t = this.terminals.get(streamId);
    if (!t) return;
    if (type === Frame.DATA) {
      this.bytesOut += payload.length; // PTY output -> browser
      t.onData(payload);
    }
    else if (type === Frame.EXIT || type === Frame.CLOSE) {
      let code = 0;
      try {
        code = JSON.parse(payload.toString("utf8")).code ?? 0;
      } catch {
        /* ignore */
      }
      t.onExit(code);
    }
  }

  failAll(): void {
    for (const t of this.terminals.values()) t.onExit(-1);
    this.terminals.clear();
  }
}

let agent: DeviceAgent | null = null;

// ---------------------------------------------------------------------------
// Static file serving for the React build.
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  let file = path.join(STATIC_DIR, rel);
  // Prevent path traversal; fall back to index.html for SPA routes.
  if (!file.startsWith(STATIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(STATIC_DIR, "index.html");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, agent: agent?.agentId ?? null }));
    return;
  }
  if ((req.url ?? "").startsWith("/__helixstats__")) {
    const now = Date.now();
    const body = agent
      ? {
          role: "shell-gateway",
          now,
          agent: agent.agentId,
          terminals: agent.terminalCount,
          out: agent.bytesOut, // device -> browser (PTY output)
          in: agent.bytesIn, // browser -> device (keystrokes)
          uptimeMs: now - agent.connectedAt,
        }
      : { role: "shell-gateway", now, agent: null };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body, null, 2));
    return;
  }
  serveStatic(req, res);
});

// ---------------------------------------------------------------------------
// WebSocket endpoints.
// ---------------------------------------------------------------------------

const agentWss = new WebSocketServer({ noServer: true });
const browserWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const pathname = (req.url ?? "/").split("?")[0];
  if (pathname === "/__shell_agent__") {
    agentWss.handleUpgrade(req, socket, head, (ws) => handleAgent(ws));
  } else if (pathname === "/__shell_ws__") {
    browserWss.handleUpgrade(req, socket, head, (ws) => handleBrowser(ws));
  } else {
    socket.destroy();
  }
});

// Detect half-open / silently-dropped sockets (laptop sleep, Wi-Fi/route drop,
// backgrounded tab, browser that never sent a close frame) via ping/pong. If a
// peer misses a full interval it is terminated, which fires 'close' and runs
// the normal teardown path. Browsers auto-reply to protocol pings, so no client
// change is needed. Returns a stopper to clear the timer on normal close.
function startHeartbeat(ws: WebSocket, intervalMs: number): () => void {
  let alive = true;
  ws.on("pong", () => {
    alive = true;
  });
  const timer = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    try {
      ws.ping();
    } catch {
      /* socket already gone */
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

function handleAgent(ws: WebSocket) {
  ws.binaryType = "nodebuffer";
  let self: DeviceAgent | null = null;

  const stopHeartbeat = startHeartbeat(ws, 20_000);

  ws.on("message", (data: Buffer) => {
    const { type, streamId, payload } = decodeFrame(data as Buffer);
    if (type === Frame.REGISTER) {
      let agentId = "default";
      try {
        agentId = JSON.parse(payload.toString("utf8")).agentId ?? "default";
      } catch {
        /* ignore */
      }
      if (agent) agent.ws.close(4000, "replaced by new agent");
      self = new DeviceAgent(ws, agentId);
      agent = self;
      ws.send(encodeJson(Frame.REGISTER_ACK, 0, { ok: true }));
      console.log(`[agent connected] id=${agentId}`);
      return;
    }
    if (self) self.dispatch(type, streamId, payload);
  });

  const cleanup = () => {
    stopHeartbeat();
    if (self && agent === self) {
      agent.failAll();
      agent = null;
      console.log(`[agent disconnected] id=${self.agentId}`);
    }
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

function handleBrowser(ws: WebSocket) {
  ws.binaryType = "nodebuffer";

  if (!agent) {
    ws.send(JSON.stringify({ type: "error", message: "no device connected" }));
    ws.close();
    return;
  }
  const a = agent;
  const stopHeartbeat = startHeartbeat(ws, 15_000);

  const streamId = a.openTerminal({
    onData(payload) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload, { binary: true });
    },
    onExit(code) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "exit", code }));
        ws.close();
      }
    },
  });

  a.sendJson(Frame.OPEN, streamId, { cols: 80, rows: 24 });
  console.log(`[terminal ${streamId}] opened on agent ${a.agentId}`);

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      a.send(Frame.DATA, streamId, data as Buffer); // stdin keystrokes
    } else {
      // Text control message from the browser (resize).
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "resize") {
          a.sendJson(Frame.RESIZE, streamId, { cols: msg.cols, rows: msg.rows });
        }
      } catch {
        /* ignore malformed control */
      }
    }
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    stopHeartbeat();
    a.send(Frame.CLOSE, streamId);
    a.closeTerminal(streamId);
    console.log(`[terminal ${streamId}] closed`);
  };
  ws.on("close", close);
  ws.on("error", close);
}

server.listen(PORT, () => {
  console.log(`helix remote-shell gateway on :${PORT} (static ${STATIC_DIR})`);
});
