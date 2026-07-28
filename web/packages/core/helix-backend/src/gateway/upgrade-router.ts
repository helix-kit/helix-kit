import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';

export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

export type UpgradeRouter = {
  // Register a handler for exactly one URL path; returns a disposer that unregisters it.
  register: (path: string, handler: UpgradeHandler) => () => void;
  close: () => void;
};

// A single `upgrade` listener that path-routes WebSocket handshakes on a shared HTTP/S server; avoids ws's `{ server, path }` form, where multiple WebSocketServers on one server abort each other's non-matching handshakes.
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
