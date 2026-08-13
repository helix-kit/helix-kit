import {
  assertHelixPacket,
  jsonPacketCodec,
  type HelixPacket,
  type HelixPacketHandler,
  type HelixTransport,
} from '@helix-hq/protocol';

export type MqttPacketAdapter = Readonly<{
  close?: () => void | Promise<void>;
  publish: (payload: string) => void | Promise<void>;
  subscribe: (handler: (payload: string) => void) => () => void;
}>;

export const createMqttTransport = (adapter: MqttPacketAdapter): HelixTransport => {
  const handlers = new Set<HelixPacketHandler>();
  const unsubscribeAdapter = adapter.subscribe((wire) => {
    const packet = assertHelixPacket(jsonPacketCodec.decode(wire));
    for (const handler of handlers) {
      handler(packet);
    }
  });

  return {
    close: async () => {
      unsubscribeAdapter();
      await adapter.close?.();
    },
    send: (packet: HelixPacket) => adapter.publish(jsonPacketCodec.encode(packet)),
    subscribe: (handler: HelixPacketHandler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
};
