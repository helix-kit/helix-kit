import { type Logger } from '@helix/logger';

import { deviceEventSubscriptionTopics, parseDeviceEventTopic } from './topic';

import type { DeviceEventQueue, RawDeviceEvent } from './queue';
import type { IPublishPacket, MqttClient } from 'mqtt';

export type DeviceEventIngestionBridgeOptions = Readonly<{
  mqttClient: MqttClient;
  queue: DeviceEventQueue;
  logger: Logger;
  batchSize?: number;
  flushIntervalMs?: number;
}>;

const MQTT_QOS_AT_LEAST_ONCE = 1;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_FLUSH_INTERVAL_MS = 5;

// Bridges device event messages from MQTT into the durable Kafka queue. Incoming
// events are micro-batched and flushed as a single multi-message produce (on a
// short timer or when the batch fills) so the per-message produce cost is
// amortized; the writer consumes the queue and persists to the database.
// Resubscribes on every (re)connect so a dropped broker connection self-heals.
export const attachDeviceEventIngestion = (options: DeviceEventIngestionBridgeOptions): void => {
  const { mqttClient, queue, logger } = options;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

  let buffer: RawDeviceEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (buffer.length === 0) {
      return;
    }
    const batch = buffer;
    buffer = [];
    void queue.publishBatch(batch).catch((error: unknown) => {
      logger.error('Failed to queue device event batch', { count: batch.length, error });
    });
  };

  const scheduleFlush = (): void => {
    flushTimer ??= setTimeout(flush, flushIntervalMs);
  };

  mqttClient.on('message', (_topic: string, payload: Buffer, packet: IPublishPacket) => {
    const parsedTopic = parseDeviceEventTopic(packet.topic);
    if (parsedTopic === null) {
      return;
    }
    buffer.push({
      deviceId: parsedTopic.deviceId,
      payload,
      receivedAt: new Date().toISOString(),
    });
    if (buffer.length >= batchSize) {
      flush();
    } else {
      scheduleFlush();
    }
  });

  mqttClient.on('connect', () => {
    mqttClient.subscribe(
      deviceEventSubscriptionTopics(),
      { qos: MQTT_QOS_AT_LEAST_ONCE },
      (error) => {
        if (error !== null) {
          logger.error('Failed to subscribe to device event topics', { error });
        }
      },
    );
  });
};
