import {
  assertHelixPacket,
  jsonPacketCodec,
  type HelixPacket,
  type HelixPacketHandler,
  type HelixTransport,
} from '@helix/protocol';

export type WebSocketTransportOptions = Readonly<{
  protocols?: string | string[];
  url: string | URL;
}>;

export const createWebSocketTransport = (options: WebSocketTransportOptions): HelixTransport => {
  const socket = new WebSocket(options.url, options.protocols);
  const handlers = new Set<HelixPacketHandler>();

  socket.addEventListener('message', (event: MessageEvent) => {
    const wire = typeof event.data === 'string' ? event.data : String(event.data);
    const packet = assertHelixPacket(jsonPacketCodec.decode(wire));
    for (const handler of handlers) {
      handler(packet);
    }
  });

  return {
    close: () => {
      socket.close();
    },
    send: (packet: HelixPacket) => {
      socket.send(jsonPacketCodec.encode(packet));
    },
    subscribe: (handler: HelixPacketHandler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
};
