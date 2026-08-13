import { attachDeviceEventIngestion, type DeviceEventQueue } from '@helix-hq/backend';
import { logger } from '@helix-hq/logger';

import { type RoleCloser } from './roles';

import { env } from '../env';
import { buildEventIngestionMqttClient, closeMqttClient } from '../mqtt';

// Subscribes to device event topics over durable MQTT 5 and micro-batches bytes into Kafka.
export const startIngest = async (deps: { queue: DeviceEventQueue }): Promise<RoleCloser> => {
  const eventIngestionClient = await buildEventIngestionMqttClient();
  attachDeviceEventIngestion({
    batchSize: env.EVENT_QUEUE_PRODUCE_BATCH_SIZE,
    flushIntervalMs: env.EVENT_QUEUE_PRODUCE_FLUSH_MS,
    logger,
    mqttClient: eventIngestionClient,
    queue: deps.queue,
  });
  logger.info(`Helix Server device event ingestion listening on ${env.EVENT_QUEUE_TOPIC}.`);

  return async () => {
    await closeMqttClient(eventIngestionClient);
  };
};
