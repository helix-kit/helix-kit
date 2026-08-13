'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  assertHelixPacket,
  jsonPacketCodec,
  type HelixPacket,
  type HelixPacketHandler,
  type HelixTransport,
} from '@helix-hq/protocol';
import { isServiceMessage, type HelixMessage } from '@helix-hq/protocol/service';
import { HelixTransportProvider } from '@helix-hq/protocol/service/react';

export type WebSocketConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

export type WebSocketProviderProps = Readonly<{
  autoConnect?: boolean;
  children: ReactNode;
  protocols?: string | string[];
  url: string | URL;
}>;

export type WebSocketTransportContextValue = Readonly<{
  connect: () => Promise<void>;
  connectionState: WebSocketConnectionState;
  disconnect: () => void;
  error: string | null;
  supported: boolean;
  transport: HelixTransport<HelixMessage>;
  url: string;
}>;

type StatusEvent =
  { type: 'connected' | 'connecting' | 'disconnected' } | { message: string; type: 'error' };

const isSupported = (): boolean => typeof WebSocket !== 'undefined';
const NORMAL_WEBSOCKET_CLOSE_CODE = 1000;

class WebSocketTransportClient implements HelixTransport<HelixMessage> {
  readonly #handlers = new Set<HelixPacketHandler<HelixMessage>>();
  readonly #statusHandlers = new Set<(event: StatusEvent) => void>();
  readonly #protocols?: string | string[];
  readonly #url: string;
  #socket: WebSocket | null = null;

  constructor(url: string | URL, protocols?: string | string[]) {
    this.#url = String(url);
    this.#protocols = protocols;
  }

  async connect(): Promise<void> {
    if (
      this.#socket?.readyState === WebSocket.OPEN ||
      this.#socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    if (!isSupported()) {
      this.#emitStatus({ message: 'WebSocket is not available in this browser.', type: 'error' });
      return;
    }

    this.#emitStatus({ type: 'connecting' });
    await new Promise<void>((resolve) => {
      const socket = new WebSocket(this.#url, this.#protocols);
      this.#socket = socket;
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      socket.addEventListener('open', () => {
        this.#emitStatus({ type: 'connected' });
        finish();
      });
      socket.addEventListener('message', (event) => {
        this.#handleMessage(event.data);
      });
      socket.addEventListener('close', () => {
        if (this.#socket === socket) {
          this.#socket = null;
        }
        this.#emitStatus({ type: 'disconnected' });
        finish();
      });
      socket.addEventListener('error', () => {
        this.#emitStatus({
          message: `WebSocket connection to ${this.#url} failed.`,
          type: 'error',
        });
        finish();
      });
    });
  }

  close(): void {
    this.disconnect();
  }

  disconnect(): void {
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null && socket.readyState < WebSocket.CLOSING) {
      socket.close(NORMAL_WEBSOCKET_CLOSE_CODE, 'manual disconnect');
    }
    this.#emitStatus({ type: 'disconnected' });
  }

  send(packet: HelixPacket<HelixMessage>): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket transport is not connected.');
    }
    this.#socket.send(jsonPacketCodec.encode(packet));
  }

  subscribe(handler: HelixPacketHandler<HelixMessage>): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  onStatus(handler: (event: StatusEvent) => void): () => void {
    this.#statusHandlers.add(handler);
    return () => this.#statusHandlers.delete(handler);
  }

  #emitStatus(event: StatusEvent): void {
    for (const handler of this.#statusHandlers) {
      handler(event);
    }
  }

  #handleMessage(wire: unknown): void {
    try {
      if (typeof wire !== 'string') {
        throw new Error('non-text WebSocket packet');
      }
      const packet = assertHelixPacket(jsonPacketCodec.decode(wire));
      if (!isServiceMessage(packet.message)) {
        throw new Error('non-service Helix packet');
      }
      for (const handler of this.#handlers) {
        handler(packet as HelixPacket<HelixMessage>);
      }
    } catch {
      this.#emitStatus({ message: 'Device emitted invalid Helix JSON.', type: 'error' });
    }
  }
}

const WebSocketTransportContext = createContext<WebSocketTransportContextValue | null>(null);

export const WebSocketProvider = ({
  autoConnect = false,
  children,
  protocols,
  url,
}: WebSocketProviderProps) => {
  const resolvedUrl = String(url);
  const supported = isSupported();
  const [connectionState, setConnectionState] = useState<WebSocketConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const client = useMemo(
    () => new WebSocketTransportClient(resolvedUrl, protocols),
    [protocols, resolvedUrl],
  );

  useEffect(() => {
    const unsubscribe = client.onStatus((event) => {
      setConnectionState(event.type);
      setError(event.type === 'error' ? event.message : null);
    });
    if (autoConnect) {
      void client.connect();
    }
    return () => {
      unsubscribe();
      client.disconnect();
    };
  }, [autoConnect, client]);

  const value = useMemo<WebSocketTransportContextValue>(
    () => ({
      connect: () => client.connect(),
      connectionState,
      disconnect: () => {
        client.disconnect();
      },
      error,
      supported,
      transport: client,
      url: resolvedUrl,
    }),
    [client, connectionState, error, resolvedUrl, supported],
  );

  return (
    <WebSocketTransportContext.Provider value={value}>
      <HelixTransportProvider
        isConnected={connectionState === 'connected'}
        transport={client}
        transportName="websocket"
      >
        {children}
      </HelixTransportProvider>
    </WebSocketTransportContext.Provider>
  );
};

export const useWebSocketTransport = (): WebSocketTransportContextValue => {
  const context = useContext(WebSocketTransportContext);
  if (context === null) {
    throw new Error('useWebSocketTransport must be used within a WebSocketProvider.');
  }
  return context;
};
