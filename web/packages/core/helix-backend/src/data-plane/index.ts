import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';

import { logger } from '@helix/logger';
import { HelixStreamSession } from '@helix/protocol-stream';
import { WebSocket, WebSocketServer } from 'ws';

import { wsTransport } from './ws-transport';

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { certSerialFromSocket, deviceIdFromSocket } from '../device-mtls/tls';
import { type UpgradeRouter } from '../gateway/upgrade-router';

// Two role-named, app-agnostic endpoints. Both are dumb byte relays: `device`
// is where a device dials its byte-stream mux in; `client` is where a browser
// attaches to a session. What the bytes mean (a terminal, a file, a TCP stream)
// lives in the device app + the browser Surface, never here — so a new app
// (uart/kvm/logs) adds zero endpoints, zero ports, zero Caddy routes. The
// client passes an opaque `meta` blob on attach and sends opaque control
// frames; the device app interprets them (shell: meta=`{cols,rows}`,
// control=resize). Neither endpoint owns a server or a port: the client rides
// the public HTTPS server (alongside /ws + the APIs) and the device rides the
// shared device mTLS server (alongside file transfer), via upgrade routers.
export const STREAM_PREFIX = '/stream';
export const DEVICE_STREAM_PATH = `${STREAM_PREFIX}/device`;
export const CLIENT_STREAM_PATH = `${STREAM_PREFIX}/client`;

type DeviceSession = { session: HelixStreamSession; deviceId: string };

// sessionId -> the device's live HelixStream connection. A device app dials the
// device endpoint after receiving an `open` command; browsers/subdomains then
// pair to it by session id.
const sessions = new Map<string, DeviceSession>();

const queryParam = (url: string | undefined, key: string): string | null =>
  new URL(url ?? '/', 'http://x').searchParams.get(key);

const registerUpgrade = (
  upgrades: UpgradeRouter,
  path: string,
  wss: WebSocketServer,
): (() => void) =>
  upgrades.register(path, (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

const MAX_HEAD_BYTES = 16_384; // 16 KiB

// The session id is the leftmost Host label: `<session>.port.<domain>`.
const sessionFromHostHead = (head: string): string | null => {
  const host = /\r\nhost:[ \t]*([^\r\n]+)/i.exec(`\r\n${head}`)?.[1]?.trim().toLowerCase();
  const label = host?.split(':')[0]?.split('.')[0];
  return label !== undefined && label !== '' ? label : null;
};

// Caddy TLS-terminates `*.port.<domain>` and reverse-proxies plain HTTP/1.1 to
// this raw listener. Peek the Host head, find the device session, open a fresh
// stream, and copy bytes both ways — the device dials its configured target, so
// the far end is whatever local service it forwards. A dumb byte relay; the
// target's own HTTP response flows straight back to Caddy.
const startPortForwardProxy = (port: number): NetServer => {
  const server = createNetServer((socket: Socket) => {
    let head = Buffer.alloc(0);
    let stream: ReturnType<HelixStreamSession['open']> | null = null;
    let piped = false;

    socket.on('data', (chunk: Buffer) => {
      if (piped) {
        if (stream !== null) {
          void stream.write(new Uint8Array(chunk));
        }
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) {
        if (head.length > MAX_HEAD_BYTES) {
          socket.destroy();
        }
        return;
      }
      const sessionId = sessionFromHostHead(head.subarray(0, end).toString('latin1'));
      const device = sessionId === null ? undefined : sessions.get(sessionId);
      if (device === undefined) {
        socket.end(
          'HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/plain\r\n\r\nno active tunnel\r\n',
        );
        return;
      }
      piped = true;
      stream = device.session.open(new Uint8Array());
      stream.onData = (data) => socket.write(Buffer.from(data));
      stream.onEnd = () => socket.end();
      stream.onClose = () => socket.end();
      void stream.write(new Uint8Array(head)); // replay the buffered request head + body
      logger.info(`data-plane: port-forward session=${sessionId} device=${device.deviceId}`);
    });
    socket.on('close', () => stream?.close());
    socket.on('error', () => stream?.reset('port-forward socket error'));
  });
  server.listen(port);
  return server;
};

export type DataPlaneOptions = {
  // The public HTTPS server's upgrade router (also serves /ws + the APIs) —
  // hosts the browser client endpoint. Fronted by Caddy public HTTPS.
  clientUpgrades: UpgradeRouter;
  // The device mTLS server's upgrade router (also serves file transfer) — hosts
  // the device endpoint. The mTLS handshake proves the device identity.
  deviceUpgrades: UpgradeRouter;
  // App-layer revocation: reject a device whose cert serial has been revoked
  // (the CRL can't ride the TLS context — see device-mtls/tls.ts).
  isRevoked?: (serial: string) => Promise<boolean>;
  // Raw-TCP port for the port-forward proxy. Caddy TLS-terminates
  // `*.port.<domain>` and reverse-proxies plain HTTP/1.1 here; the leftmost
  // Host label is the session id. When set, opens a listener that pipes each
  // connection into a fresh stream on that device session (the device dials its
  // configured target and copies bytes). No app semantics here — a dumb relay.
  portForwardPort?: number;
};

export type StartedDataPlane = { close: () => Promise<void> };

/**
 * The HelixStream data plane, two endpoints on servers that already exist:
 *   - device (mTLS)  /stream/device?session=<id>            devices dial their mux in
 *   - client (Caddy) /stream/client?session=<id>&meta=<blob>  browsers attach
 * Both are pure byte relays; app meaning lives in the device app + Surface.
 * Control (open/close) rides the existing MQTT gateway; only bytes flow here.
 */
export const startDataPlane = async (options: DataPlaneOptions): Promise<StartedDataPlane> => {
  const deviceWss = new WebSocketServer({ noServer: true });
  const clientWss = new WebSocketServer({ noServer: true });

  const unregDevice = registerUpgrade(options.deviceUpgrades, DEVICE_STREAM_PATH, deviceWss);
  const unregClient = registerUpgrade(options.clientUpgrades, CLIENT_STREAM_PATH, clientWss);

  const registerDeviceStream = (socket: WebSocket, sessionId: string, deviceId: string): void => {
    const session = new HelixStreamSession(wsTransport(socket), { client: true });
    sessions.set(sessionId, { session, deviceId });
    session.onClose = () => {
      if (sessions.get(sessionId)?.session === session) {
        sessions.delete(sessionId);
      }
    };
    logger.info(`data-plane: device stream registered session=${sessionId} device=${deviceId}`);
  };

  deviceWss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    const sessionId = queryParam(request.url, 'session');
    // The device identity is authoritative from the client cert CN, not a query
    // param — the mTLS handshake already proved it.
    const deviceId = deviceIdFromSocket(request.socket) ?? 'unknown';
    if (sessionId === null) {
      socket.close();
      return;
    }
    const serial = certSerialFromSocket(request.socket);
    if (options.isRevoked === undefined || serial === null) {
      registerDeviceStream(socket, sessionId, deviceId);
      return;
    }
    void options
      .isRevoked(serial)
      .then((revoked) => {
        if (revoked) {
          logger.info(`data-plane: rejected revoked device ${deviceId} session=${sessionId}`);
          socket.close();
        } else {
          registerDeviceStream(socket, sessionId, deviceId);
        }
        return undefined;
      })
      .catch(() => {
        socket.close();
      });
  });

  clientWss.on('connection', (client: WebSocket, request: IncomingMessage) => {
    const sessionId = queryParam(request.url, 'session');
    const metaParam = queryParam(request.url, 'meta');
    const device = sessionId === null ? undefined : sessions.get(sessionId);
    if (device === undefined) {
      client.send(JSON.stringify({ type: 'error', message: 'no device stream for session' }));
      client.close();
      return;
    }

    client.binaryType = 'nodebuffer';
    // `meta` is opaque here — the device app decides what it means (shell reads
    // it as JSON `{cols,rows}` to size the PTY).
    const meta = metaParam === null ? new Uint8Array() : new TextEncoder().encode(metaParam);
    const stream = device.session.open(meta);

    stream.onData = (chunk) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(chunk, { binary: true });
      }
    };
    stream.onEnd = () => {
      client.close();
    };
    stream.onClose = () => {
      client.close();
    };

    client.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        void stream.write(new Uint8Array(data)); // payload bytes (e.g. keystrokes)
      } else {
        // Any text frame is an opaque app control signal, forwarded verbatim as
        // a SIGNAL frame; the device app interprets it (shell: `{type:resize}`).
        stream.signal(new Uint8Array(data));
      }
    });
    client.on('close', () => {
      stream.close();
    });
    client.on('error', () => {
      stream.reset('client socket error');
    });
  });

  const pfServer =
    options.portForwardPort !== undefined ? startPortForwardProxy(options.portForwardPort) : null;

  logger.info(
    `Helix data plane ready: client on the public server, device on the mTLS server${
      pfServer === null ? '' : `, port-forward on ${options.portForwardPort}`
    }.`,
  );

  return {
    close: async () => {
      unregDevice();
      unregClient();
      for (const { session } of sessions.values()) {
        session.close();
      }
      sessions.clear();
      await new Promise<void>((resolve) => {
        deviceWss.close(() => {
          resolve();
        });
      });
      await new Promise<void>((resolve) => {
        clientWss.close(() => {
          resolve();
        });
      });
      if (pfServer !== null) {
        await new Promise<void>((resolve) =>
          pfServer.close(() => {
            resolve();
          }),
        );
      }
    },
  };
};
