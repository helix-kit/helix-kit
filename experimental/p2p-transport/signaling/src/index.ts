// Helix P2P signaling server (experimental).
//
// The ONLY job of this box (which runs on EC2) is to introduce two peers so they
// can establish a *direct* WebRTC connection. Once the DataChannel opens, all
// bulk data (files, media, streams) flows peer-to-peer and NEVER touches this
// server — that is the whole point: bypass EC2 bandwidth.
//
// It does three things:
//   - serve the static web client                          (GET / ...)
//   - relay opaque signaling JSON between the two room peers (/__p2p__ WS)
//   - report how many *signaling* bytes it relayed          (/__p2pstats__)
//
// A "room" is a rendezvous id shared out-of-band by the two peers. Each room
// holds at most one `device` and one `browser`. The device is the WebRTC
// initiator (creates the offer + DataChannel); the browser answers.
//
// WARNING (experimental): NO auth. Anyone who knows a room id can join it. The
// productization path (capability tokens, mTLS device identity) is doc 10.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT ?? 9200);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = process.env.STATIC_DIR ?? path.resolve(__dirname, "../../web");

type Role = "device" | "browser";

interface Peer {
  ws: WebSocket;
  role: Role;
}

// A rendezvous point for exactly two peers.
class Room {
  device: Peer | null = null;
  browser: Peer | null = null;
  // Signaling bytes relayed through this server for this room. This is the
  // number we want to stay tiny while gigabytes flow P2P off to the side.
  bytesRelayed = 0;
  readonly createdAt = Date.now();

  peer(role: Role): Peer | null {
    return role === "device" ? this.device : this.browser;
  }
  other(role: Role): Peer | null {
    return role === "device" ? this.browser : this.device;
  }
  set(role: Role, p: Peer | null): void {
    if (role === "device") this.device = p;
    else this.browser = p;
  }
  get empty(): boolean {
    return !this.device && !this.browser;
  }
}

const rooms = new Map<string, Room>();

function getRoom(id: string): Room {
  let r = rooms.get(id);
  if (!r) {
    r = new Room();
    rooms.set(id, r);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Static file serving for the web client (single-origin with the WS endpoint,
// so the browser page and its signaling socket share scheme/host).
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  let file = path.join(STATIC_DIR, rel);
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
  const url = req.url ?? "/";
  if (url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  if (url.startsWith("/__p2pstats__")) {
    const now = Date.now();
    const body = {
      role: "p2p-signaling",
      now,
      rooms: [...rooms.entries()].map(([id, r]) => ({
        id,
        device: !!r.device,
        browser: !!r.browser,
        // The killer metric: total signaling bytes relayed by EC2 for this
        // room. The actual file/media payload does NOT appear here.
        signalingBytesRelayed: r.bytesRelayed,
        uptimeMs: now - r.createdAt,
      })),
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body, null, 2));
    return;
  }
  serveStatic(req, res);
});

// ---------------------------------------------------------------------------
// Signaling WebSocket: /__p2p__?room=<id>&role=<device|browser>
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url ?? "/", "http://x");
  if (pathname !== "/__p2p__") {
    socket.destroy();
    return;
  }
  const roomId = searchParams.get("room") ?? "";
  const role = searchParams.get("role");
  if (!roomId || (role !== "device" && role !== "browser")) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => handlePeer(ws, roomId, role));
});

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function handlePeer(ws: WebSocket, roomId: string, role: Role): void {
  const room = getRoom(roomId);

  // Evict a stale same-role peer (last writer wins — matches the other
  // experiments' MVP semantics).
  const existing = room.peer(role);
  if (existing) existing.ws.close(4000, "replaced by new peer");

  const self: Peer = { ws, role };
  room.set(role, self);
  console.log(`[join] room=${roomId} role=${role}`);

  // If both peers are now present, tell each to begin negotiation. The device
  // is the initiator: it creates the DataChannel and the SDP offer.
  const announce = () => {
    if (room.device && room.browser) {
      send(room.device.ws, { type: "ready", initiator: true });
      send(room.browser.ws, { type: "ready", initiator: false });
      console.log(`[ready] room=${roomId} — both peers present`);
    }
  };
  announce();

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) return; // signaling is JSON text only
    room.bytesRelayed += data.length;
    const other = room.other(role);
    // Opaque relay: we forward the SDP/ICE JSON verbatim, never inspecting it.
    if (other && other.ws.readyState === WebSocket.OPEN) {
      other.ws.send(data.toString("utf8"));
    }
  });

  const cleanup = () => {
    if (room.peer(role) === self) {
      room.set(role, null);
      const other = room.other(role);
      if (other) send(other.ws, { type: "peer-left" });
      if (room.empty) rooms.delete(roomId);
      console.log(`[leave] room=${roomId} role=${role}`);
    }
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

server.listen(PORT, () => {
  console.log(`helix p2p signaling on :${PORT} (static ${STATIC_DIR})`);
});
