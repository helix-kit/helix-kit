// Helix port-forwarding gateway: multiplexes every browser connection for a session over the one persistent WebSocket the owning agent holds open, streaming everything (never buffering whole responses).

import http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import {
  Frame,
  decodeFrame,
  encodeFrame,
  encodeJson,
  HOP_BY_HOP,
} from "./protocol.js";

const PORT = Number(process.env.PORT ?? 9000);
const BASE_DOMAIN = process.env.BASE_DOMAIN ?? "port.helix-kit.com";
const TUNNEL_PATH = "/__tunnel__";
// Reserved for the agent control channel; can never be a session id.
const CONNECT_SUBDOMAIN = "connect";

interface Stream {
  onHead?(status: number, headers: Record<string, string>): void;
  onData(payload: Buffer): void;
  onEnd(): void;
  onAbort(msg: string): void;
}

class Agent {
  readonly sessionId: string;
  readonly target: string;
  private nextStreamId = 2; // 0 = control, evens = gateway-allocated
  private readonly streams = new Map<number, Stream>();

  up = 0;
  down = 0;
  readonly connectedAt = Date.now();

  constructor(
    public readonly ws: WebSocket,
    sessionId: string,
    target: string,
  ) {
    this.sessionId = sessionId;
    this.target = target;
  }

  openStream(s: Stream): number {
    const id = this.nextStreamId;
    this.nextStreamId += 2;
    this.streams.set(id, s);
    return id;
  }

  closeStream(id: number): void {
    this.streams.delete(id);
  }

  send(type: Frame, streamId: number, payload?: Buffer): void {
    if (payload && (type === Frame.REQ_DATA || type === Frame.WS_DATA)) {
      this.up += payload.length; // browser -> device
    }
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeFrame(type, streamId, payload));
    }
  }

  sendJson(type: Frame, streamId: number, obj: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeJson(type, streamId, obj));
    }
  }

  dispatch(type: Frame, streamId: number, payload: Buffer): void {
    const s = this.streams.get(streamId);
    if (!s) return;
    switch (type) {
      case Frame.RES_HEAD: {
        try {
          const head = JSON.parse(payload.toString("utf8")) as {
            status: number;
            headers: Record<string, string>;
          };
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(head.headers ?? {})) {
            if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
          }
          s.onHead?.(head.status || 502, headers);
        } catch {
          s.onHead?.(502, {});
        }
        break;
      }
      case Frame.RES_DATA:
      case Frame.WS_ACK:
      case Frame.WS_DATA:
        this.down += payload.length; // device -> browser
        s.onData(payload);
        break;
      case Frame.RES_END:
      case Frame.WS_CLOSE:
        s.onEnd();
        break;
      case Frame.ABORT: {
        let msg = "aborted by agent";
        try {
          msg = JSON.parse(payload.toString("utf8")).error ?? msg;
        } catch {
          /* ignore */
        }
        s.onAbort(msg);
        break;
      }
    }
  }

  failAll(msg: string): void {
    for (const s of this.streams.values()) s.onAbort(msg);
    this.streams.clear();
  }
}

const agents = new Map<string, Agent>();

function subdomainOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.split(":")[0].toLowerCase();
  if (!host.endsWith("." + BASE_DOMAIN)) return null;
  const label = host.slice(0, host.length - BASE_DOMAIN.length - 1);
  if (label.includes(".")) return label.split(".")[0];
  return label;
}

function filterHeaders(
  headers: http.IncomingHttpHeaders,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

const server = http.createServer((req, res) => {
  // Handled before host routing so it works on any host.
  if ((req.url ?? "").startsWith("/__helixstats__")) {
    const now = Date.now();
    const sessions = [...agents.values()].map((a) => ({
      session: a.sessionId,
      target: a.target,
      up: a.up,
      down: a.down,
      uptimeMs: now - a.connectedAt,
    }));
    const totals = sessions.reduce(
      (t, s) => ({ up: t.up + s.up, down: t.down + s.down }),
      { up: 0, down: 0 },
    );
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ role: "port-gateway", now, totals, sessions }, null, 2));
    return;
  }

  const sub = subdomainOf(req.headers.host);
  if (!sub) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("helix port-forwarding gateway\n");
    return;
  }
  const agent = agents.get(sub);
  if (!agent) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`no active tunnel for session "${sub}"\n`);
    return;
  }

  const streamId = agent.openStream({
    onHead(status, headers) {
      res.writeHead(status, headers);
    },
    onData(payload) {
      res.write(payload);
    },
    onEnd() {
      res.end();
      agent.closeStream(streamId);
    },
    onAbort(msg) {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(res.headersSent ? "" : `tunnel error: ${msg}\n`);
      agent.closeStream(streamId);
    },
  });

  agent.sendJson(Frame.REQ_HEAD, streamId, {
    method: req.method,
    url: req.url,
    headers: filterHeaders(req.headers),
  });

  req.on("data", (chunk: Buffer) => agent.send(Frame.REQ_DATA, streamId, chunk));
  req.on("end", () => agent.send(Frame.REQ_END, streamId));
  req.on("error", () => agent.send(Frame.ABORT, streamId));

  res.on("close", () => {
    if (!res.writableEnded) agent.send(Frame.ABORT, streamId);
    agent.closeStream(streamId);
  });
});

const tunnelWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const sub = subdomainOf(req.headers.host);

  // Agent control channel.
  if (url.pathname === TUNNEL_PATH && sub === CONNECT_SUBDOMAIN) {
    tunnelWss.handleUpgrade(req, socket, head, (ws) =>
      handleAgentConnection(ws),
    );
    return;
  }

  // Browser WebSocket to a proxied local service -> raw byte pipe.
  if (!sub) {
    socket.destroy();
    return;
  }
  const agent = agents.get(sub);
  if (!agent) {
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\nno active tunnel\n");
    socket.destroy();
    return;
  }
  proxyWebSocket(agent, req, socket, head);
});

function proxyWebSocket(
  agent: Agent,
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
) {
  const streamId = agent.openStream({
    onData(payload) {
      socket.write(payload);
    },
    onEnd() {
      socket.end();
      agent.closeStream(streamId);
    },
    onAbort() {
      socket.destroy();
      agent.closeStream(streamId);
    },
  });

  // Reconstruct the raw upgrade request head for the local service.
  let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    const val = Array.isArray(v) ? v.join(", ") : v;
    raw += `${k}: ${val}\r\n`;
  }
  raw += "\r\n";
  const openPayload = Buffer.concat([Buffer.from(raw, "latin1"), head]);
  agent.send(Frame.WS_OPEN, streamId, openPayload);

  socket.on("data", (chunk: Buffer) =>
    agent.send(Frame.WS_DATA, streamId, chunk),
  );
  socket.on("close", () => {
    agent.send(Frame.WS_CLOSE, streamId);
    agent.closeStream(streamId);
  });
  socket.on("error", () => {
    agent.send(Frame.WS_CLOSE, streamId);
    agent.closeStream(streamId);
  });
}

function handleAgentConnection(ws: WebSocket) {
  let agent: Agent | null = null;
  ws.binaryType = "nodebuffer";

  const pinger = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 20_000);

  ws.on("message", (data: Buffer) => {
    const { type, streamId, payload } = decodeFrame(data as Buffer);

    if (type === Frame.REGISTER) {
      let reg: { sessionId?: string; target?: string };
      try {
        reg = JSON.parse(payload.toString("utf8"));
      } catch {
        ws.close(1002, "bad register");
        return;
      }
      const sessionId = (reg.sessionId ?? "").toLowerCase();
      if (!sessionId || sessionId === CONNECT_SUBDOMAIN) {
        ws.send(encodeJson(Frame.REGISTER_ACK, 0, { ok: false, error: "invalid session id" }));
        ws.close();
        return;
      }
      const prev = agents.get(sessionId);
      if (prev) prev.ws.close(4000, "replaced by new agent");
      agent = new Agent(ws, sessionId, reg.target ?? "unknown");
      agents.set(sessionId, agent);
      ws.send(
        encodeJson(Frame.REGISTER_ACK, 0, {
          ok: true,
          host: `${sessionId}.${BASE_DOMAIN}`,
        }),
      );
      console.log(
        `[register] session=${sessionId} target=${agent.target} public=https://${sessionId}.${BASE_DOMAIN}`,
      );
      return;
    }

    if (!agent) {
      ws.close(1002, "not registered");
      return;
    }

    agent.dispatch(type, streamId, payload);
  });

  const cleanup = (reason: string) => {
    clearInterval(pinger);
    if (agent && agents.get(agent.sessionId) === agent) {
      agents.delete(agent.sessionId);
      agent.failAll(reason);
      console.log(`[disconnect] session=${agent.sessionId} (${reason})`);
    }
  };
  ws.on("close", () => cleanup("agent disconnected"));
  ws.on("error", () => cleanup("agent socket error"));
}

server.listen(PORT, () => {
  console.log(
    `helix port-forwarding gateway listening on :${PORT} (base domain ${BASE_DOMAIN})`,
  );
});
