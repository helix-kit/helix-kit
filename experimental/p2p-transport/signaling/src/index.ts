// Helix P2P signaling server: introduces two room peers so they can establish a direct WebRTC connection; bulk data then flows peer-to-peer, never through here.
//
// WARNING (experimental): NO auth. Anyone who knows a room id can join it.

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

// Room is a rendezvous point for exactly two peers.
class Room {
  device: Peer | null = null;
  browser: Peer | null = null;
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

// Signaling WebSocket: /__p2p__?room=<id>&role=<device|browser>
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

  // Evict a stale same-role peer (last writer wins).
  const existing = room.peer(role);
  if (existing) existing.ws.close(4000, "replaced by new peer");

  const self: Peer = { ws, role };
  room.set(role, self);
  console.log(`[join] room=${roomId} role=${role}`);

  // When both peers are present, the device is told to initiate (DataChannel + offer).
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
