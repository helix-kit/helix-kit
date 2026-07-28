import crypto from 'node:crypto';

import { assertHelixPacket, jsonPacketCodec, type HelixPacket } from '@helix/protocol-core';
import { isServiceMessage, type HelixMessage } from '@helix/protocol-service';
import { WebSocket, WebSocketServer } from 'ws';

import { GatewayRouter, type GatewayClient } from './router';
import { type UpgradeRouter } from './upgrade-router';

import type mqtt from 'mqtt';

type AuthContext = Readonly<{
  token: string | null;
}>;

export type MqttGatewayBridgeOptions = Readonly<{
  // Shares the public server with the APIs and data-plane endpoint via one upgrade router.
  upgrades: UpgradeRouter;
  mqttClient: mqtt.MqttClient;
  websocketPath?: string;
}>;

export type StartedMqttGatewayBridge = Readonly<{
  close: () => Promise<void>;
}>;

const POLICY_VIOLATION_CLOSE_CODE = 1008;

const deviceInTopic = (deviceId: string): string => `helix/device/${deviceId}/in`;

const closeWebSocketServer = (wsServer: WebSocketServer): Promise<void> =>
  new Promise((resolve, reject) => {
    wsServer.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const parseConnection = (
  requestUrl: string | undefined,
): { deviceId: string; token: string | null } => {
  const url = new URL(requestUrl ?? '/', 'http://localhost');
  const rawConnection = url.searchParams.get('connection');
  if (rawConnection !== null && rawConnection.trim() !== '') {
    const parsed = JSON.parse(Buffer.from(rawConnection, 'base64url').toString('utf8')) as {
      deviceId?: unknown;
      token?: unknown;
    };
    if (typeof parsed.deviceId === 'string' && parsed.deviceId.trim() !== '') {
      return {
        deviceId: parsed.deviceId.trim(),
        token: typeof parsed.token === 'string' ? parsed.token : null,
      };
    }
  }

  const deviceId = url.searchParams.get('deviceId')?.trim();
  if (deviceId === undefined || deviceId === '') {
    throw new Error('connection string or deviceId query parameter is required');
  }
  return {
    deviceId,
    token: url.searchParams.get('token'),
  };
};

const readPacket = (data: WebSocket.RawData): HelixPacket<HelixMessage> => {
  let wire: string;
  if (Array.isArray(data)) {
    wire = Buffer.concat(data).toString('utf8');
  } else {
    wire = data.toString('utf8');
  }
  const packet = assertHelixPacket(jsonPacketCodec.decode(wire));
  if (!isServiceMessage(packet.message)) {
    throw new Error('Helix packet message must contain service and method.');
  }
  return packet as HelixPacket<HelixMessage>;
};

export const startMqttGatewayBridge = async (
  options: MqttGatewayBridgeOptions,
): Promise<StartedMqttGatewayBridge> => {
  const { mqttClient, upgrades } = options;
  const router = new GatewayRouter<AuthContext>((deviceId, packet) => {
    mqttClient.publish(deviceInTopic(deviceId), jsonPacketCodec.encode(packet), { qos: 1 });
  });

  const wsServer = new WebSocketServer({ noServer: true });
  const unregister = upgrades.register(options.websocketPath ?? '/ws', (request, socket, head) => {
    wsServer.handleUpgrade(request, socket, head, (ws) => wsServer.emit('connection', ws, request));
  });

  mqttClient.on('connect', () => {
    mqttClient.subscribe('helix/device/+/out', { qos: 1 });
  });

  mqttClient.on('message', (topic, payload) => {
    const match = /^helix\/device\/([^/]+)\/out$/.exec(topic);
    const deviceId = match?.[1];
    if (deviceId === undefined) {
      return;
    }
    const packet = assertHelixPacket(jsonPacketCodec.decode(payload.toString()));
    if (!isServiceMessage(packet.message)) {
      return;
    }
    void router.receiveFromDevice(deviceId, packet as HelixPacket<HelixMessage>);
  });

  wsServer.on('connection', (socket, request) => {
    let connection: { deviceId: string; token: string | null };
    try {
      connection = parseConnection(request.url);
    } catch (error) {
      socket.close(
        POLICY_VIOLATION_CLOSE_CODE,
        error instanceof Error ? error.message : 'invalid connection',
      );
      return;
    }

    const connectionId = crypto.randomUUID();
    const client: GatewayClient<AuthContext> = {
      context: {
        auth: { token: connection.token },
        connectionId,
        deviceId: connection.deviceId,
      },
      send: (packet) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(jsonPacketCodec.encode(packet));
        }
      },
    };

    router.addClient(client);

    socket.on('message', (data) => {
      try {
        void router.receiveFromClient(connectionId, readPacket(data));
      } catch (error) {
        socket.send(
          jsonPacketCodec.encode({
            message: {
              method: 'gateway-error',
              payload: { error: error instanceof Error ? error.message : 'invalid packet' },
              service: 'gateway',
            },
          }),
        );
      }
    });
    socket.on('close', () => {
      router.removeClient(connectionId);
    });
  });

  return {
    close: async () => {
      unregister();
      await closeWebSocketServer(wsServer);
    },
  };
};
