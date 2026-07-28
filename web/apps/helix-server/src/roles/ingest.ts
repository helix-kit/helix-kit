import { attachDeviceEventIngestion, type DeviceEventQueue } from '@helix/backend';
import { logger } from '@helix/logger';

import { type RoleCloser } from './roles';

import { env } from '../env';
import { buildEventIngestionMqttClient, closeMqttClient } from '../mqtt';

// The ingest role subscribes to device event topics over a durable MQTT 5
// session and micro-batches the raw bytes into the Kafka event queue.
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
