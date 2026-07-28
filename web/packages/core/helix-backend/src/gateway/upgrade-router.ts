import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';

export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

export type UpgradeRouter = {
  // Register a handler for exactly one URL path; returns a disposer that
  // unregisters it.
  register: (path: string, handler: UpgradeHandler) => () => void;
  close: () => void;
};

// A single `upgrade` listener that path-routes WebSocket handshakes on a shared
// HTTP/S server, so several endpoints (/ws, /stream/client, ...) live on one
// port. This is the documented `ws` pattern for multiple servers behind one
// HTTP server — and it avoids ws's `{ server, path }` form, where each
// WebSocketServer aborts every handshake that doesn't match its own path (which
// would make two endpoints on one server kill each other). Unmatched paths are
// destroyed here, once.
export const createUpgradeRouter = (server: HttpServer | HttpsServer): UpgradeRouter => {
  const routes = new Map<string, UpgradeHandler>();
  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const handler = routes.get(path);
    if (handler !== undefined) {
      handler(request, socket, head);
    } else {
      socket.destroy();
    }
  };
  server.on('upgrade', onUpgrade);
  return {
    register: (path, handler) => {
      routes.set(path, handler);
      return () => {
        if (routes.get(path) === handler) {
          routes.delete(path);
        }
      };
    },
    close: () => {
      server.off('upgrade', onUpgrade);
      routes.clear();
    },
  };
};
