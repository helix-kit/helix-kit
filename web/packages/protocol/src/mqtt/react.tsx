'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  assertHelixPacket,
  jsonPacketCodec,
  type HelixPacket,
  type HelixPacketHandler,
  type HelixTransport,
} from '@helix/protocol';
import { isServiceMessage, type HelixMessage } from '@helix/protocol/service';
import { HelixTransportProvider } from '@helix/protocol/service/react';

export type MqttGatewayConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

export type MqttGatewayTransportClientOptions = Readonly<{
  deviceId: string;
  gatewayUrl?: string | URL;
  token?: string | null;
  websocketProtocols?: string | readonly string[];
}>;

export type MqttGatewayProviderProps = MqttGatewayTransportClientOptions &
  Readonly<{
    children: ReactNode;
  }>;

export type MqttGatewayTransportContextValue = Readonly<{
  connect: () => Promise<void>;
  connectionState: MqttGatewayConnectionState;
  deviceId: string;
  disconnect: () => Promise<void>;
  error: string | null;
  gatewayUrl: string;
  supported: boolean;
  transport: HelixTransport<HelixMessage>;
}>;

export type MqttGatewayTransportStatusEvent =
  | { type: 'connecting' }
  | { type: 'connected' }
  | { reason?: string; type: 'disconnected' }
  | { message: string; type: 'error' };

type StatusHandler = (event: MqttGatewayTransportStatusEvent) => void;

export const DEFAULT_MQTT_GATEWAY_PATH = '/ws';
export const DEFAULT_MQTT_GATEWAY_PORT = 4010;
const NORMAL_WEBSOCKET_CLOSE_CODE = 1000;

const getDefaultGatewayUrl = (): string => {
  if (typeof window === 'undefined') {
    return `ws://localhost:${DEFAULT_MQTT_GATEWAY_PORT}${DEFAULT_MQTT_GATEWAY_PATH}`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//localhost:${DEFAULT_MQTT_GATEWAY_PORT}${DEFAULT_MQTT_GATEWAY_PATH}`;
};

const resolveGatewayUrl = (
  gatewayUrl: string | URL | undefined,
  deviceId: string,
  token: string | null | undefined,
): string => {
  const resolved = new URL(String(gatewayUrl ?? getDefaultGatewayUrl()));
  resolved.searchParams.set('deviceId', deviceId);
  if (token !== undefined && token !== null && token.length > 0) {
    resolved.searchParams.set('token', token);
  }
  return resolved.toString();
};

const isWebSocketSupported = (): boolean => typeof WebSocket !== 'undefined';

export class MqttGatewayTransportClient implements HelixTransport<HelixMessage> {
  readonly #handlers = new Set<HelixPacketHandler<HelixMessage>>();
  readonly #statusHandlers = new Set<StatusHandler>();
  readonly #url: string;
  readonly #websocketProtocols?: string | readonly string[];
  #socket: WebSocket | null = null;

  constructor(options: MqttGatewayTransportClientOptions) {
    this.#url = resolveGatewayUrl(options.gatewayUrl, options.deviceId, options.token);
    this.#websocketProtocols = options.websocketProtocols;
  }

  async connect(): Promise<void> {
    if (
      this.#socket?.readyState === WebSocket.OPEN ||
      this.#socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    if (!isWebSocketSupported()) {
      this.#emitStatus({ message: 'WebSocket is not available in this browser.', type: 'error' });
      return;
    }

    this.#emitStatus({ type: 'connecting' });

    await new Promise<void>((resolve) => {
      const socket = new WebSocket(
        this.#url,
        this.#websocketProtocols as string | string[] | undefined,
      );
      this.#socket = socket;

      socket.addEventListener('open', () => {
        this.#emitStatus({ type: 'connected' });
        resolve();
      });

      socket.addEventListener('message', (event) => {
        this.#handleMessage(event.data);
      });

      socket.addEventListener('close', (event) => {
        if (this.#socket === socket) {
          this.#socket = null;
        }
        this.#emitStatus({
          reason: event.reason !== '' ? event.reason : `code ${event.code}`,
          type: 'disconnected',
        });
        resolve();
      });

      socket.addEventListener('error', () => {
        this.#emitStatus({ message: 'MQTT gateway WebSocket connection failed.', type: 'error' });
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    await this.disconnect('transport closed');
  }

  async disconnect(reason = 'manual disconnect'): Promise<void> {
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null && socket.readyState !== WebSocket.CLOSED) {
      socket.close(NORMAL_WEBSOCKET_CLOSE_CODE, reason);
    }
    this.#emitStatus({ reason, type: 'disconnected' });
  }

  send(packet: HelixPacket<HelixMessage>): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      this.#emitStatus({ message: 'MQTT gateway WebSocket is not connected.', type: 'error' });
      return;
    }

    this.#socket.send(jsonPacketCodec.encode(packet));
  }

  subscribe(handler: HelixPacketHandler<HelixMessage>): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.#statusHandlers.add(handler);
    return () => {
      this.#statusHandlers.delete(handler);
    };
  }

  readonly #handleMessage = (wire: unknown) => {
    try {
      if (typeof wire !== 'string') {
        this.#emitStatus({ message: 'MQTT gateway emitted a non-text packet.', type: 'error' });
        return;
      }

      const packet = assertHelixPacket(jsonPacketCodec.decode(wire));
      if (!isServiceMessage(packet.message)) {
        this.#emitStatus({
          message: 'MQTT gateway packet was not a service packet.',
          type: 'error',
        });
        return;
      }

      for (const handler of this.#handlers) {
        handler(packet as HelixPacket<HelixMessage>);
      }
    } catch {
      this.#emitStatus({ message: 'MQTT gateway emitted invalid Helix JSON.', type: 'error' });
    }
  };

  #emitStatus(event: MqttGatewayTransportStatusEvent): void {
    for (const handler of this.#statusHandlers) {
      handler(event);
    }
  }
}

const MqttGatewayTransportContext = createContext<MqttGatewayTransportContextValue | null>(null);

export const MqttGatewayProvider = ({
  children,
  deviceId,
  gatewayUrl,
  token,
  websocketProtocols,
}: MqttGatewayProviderProps) => {
  const [connectionState, setConnectionState] =
    useState<MqttGatewayConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const supported = isWebSocketSupported();
  const resolvedGatewayUrl = useMemo(
    () => resolveGatewayUrl(gatewayUrl, deviceId, token),
    [deviceId, gatewayUrl, token],
  );

  const client = useMemo(
    () =>
      new MqttGatewayTransportClient({
        deviceId,
        gatewayUrl,
        token,
        websocketProtocols,
      }),
    [deviceId, gatewayUrl, token, websocketProtocols],
  );

  useEffect(() => {
    const unsubscribe = client.onStatus((event) => {
      switch (event.type) {
        case 'connecting':
          setConnectionState('connecting');
          setError(null);
          break;
        case 'connected':
          setConnectionState('connected');
          setError(null);
          break;
        case 'disconnected':
          setConnectionState('disconnected');
          break;
        case 'error':
          setConnectionState('error');
          setError(event.message);
          break;
      }
    });

    void client.connect();

    return () => {
      unsubscribe();
      void client.disconnect('provider unmounted');
    };
  }, [client]);

  const value = useMemo<MqttGatewayTransportContextValue>(
    () => ({
      connect: () => client.connect(),
      connectionState,
      deviceId,
      disconnect: () => client.disconnect('manual disconnect'),
      error,
      gatewayUrl: resolvedGatewayUrl,
      supported,
      transport: client,
    }),
    [client, connectionState, deviceId, error, resolvedGatewayUrl, supported],
  );

  return (
    <MqttGatewayTransportContext.Provider value={value}>
      <HelixTransportProvider
        isConnected={connectionState === 'connected'}
        transport={client}
        transportName="mqtt-gateway"
      >
        {children}
      </HelixTransportProvider>
    </MqttGatewayTransportContext.Provider>
  );
};

export const useMqttGatewayTransport = (): MqttGatewayTransportContextValue => {
  const context = useContext(MqttGatewayTransportContext);
  if (context === null) {
    throw new Error('useMqttGatewayTransport must be used within a MqttGatewayProvider.');
  }

  return context;
};
