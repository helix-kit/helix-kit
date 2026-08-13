import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';

import { logger } from '@helix-hq/logger';
import { HelixStreamSession } from '@helix-hq/protocol/stream';
import { WebSocket, WebSocketServer } from 'ws';

import { wsTransport } from './ws-transport';

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { certSerialFromSocket, deviceIdFromSocket } from '../device-mtls/tls';
import { type UpgradeRouter } from '../gateway/upgrade-router';

// Two role-named, app-agnostic endpoints — dumb byte relays; bytes mean nothing
// here (a terminal, a file, a TCP stream) so a new app adds zero endpoints/ports.
export const STREAM_PREFIX = '/stream';
export const DEVICE_STREAM_PATH = `${STREAM_PREFIX}/device`;
export const CLIENT_STREAM_PATH = `${STREAM_PREFIX}/client`;

type DeviceSession = { session: HelixStreamSession; deviceId: string };

// sessionId -> the device's live HelixStream connection.
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

const MAX_HEAD_BYTES = 16_384;

// The session id is the leftmost Host label: `<session>.port.<domain>`.
const sessionFromHostHead = (head: string): string | null => {
  const host = /\r\nhost:[ \t]*([^\r\n]+)/i.exec(`\r\n${head}`)?.[1]?.trim().toLowerCase();
  const label = host?.split(':')[0]?.split('.')[0];
  return label !== undefined && label !== '' ? label : null;
};

// Caddy TLS-terminates `*.port.<domain>` and reverse-proxies plain HTTP/1.1 here; peek the Host head, find the device session, and pipe bytes both ways.
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
  // The public HTTPS server's upgrade router — hosts the browser client endpoint.
  clientUpgrades: UpgradeRouter;
  // The device mTLS server's upgrade router — hosts the device endpoint.
  deviceUpgrades: UpgradeRouter;
  // App-layer revocation check (the CRL can't ride the TLS context — see device-mtls/tls.ts).
  isRevoked?: (serial: string) => Promise<boolean>;
  // Raw-TCP port for the port-forward proxy; opens a listener that pipes each connection into a fresh device-session stream.
  portForwardPort?: number;
};

export type StartedDataPlane = { close: () => Promise<void> };

/** The HelixStream data plane: two byte-relay endpoints (device mTLS, client Caddy) on servers that already exist; control rides the existing MQTT gateway. */
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
    // Device identity comes from the client cert CN, not the query param — the mTLS handshake already proved it.
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
    // `meta` is opaque here — the device app decides what it means (shell reads it as JSON `{cols,rows}`).
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
        void stream.write(new Uint8Array(data));
      } else {
        // Text frames are opaque app control signals, forwarded verbatim as a SIGNAL frame.
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
