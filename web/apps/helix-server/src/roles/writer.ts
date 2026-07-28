import { DeviceEventWriter, type DatabaseClient, type DeviceEventQueue } from '@helix/backend';
import { logger } from '@helix/logger';

import { type RoleCloser } from './roles';

import { env } from '../env';

export const startWriter = async (deps: {
  db: DatabaseClient;
  queue: DeviceEventQueue;
}): Promise<RoleCloser> => {
  const eventWriter = new DeviceEventWriter({
    batchSize: env.EVENT_QUEUE_WRITER_BATCH_SIZE,
    concurrency: env.EVENT_QUEUE_WRITER_CONCURRENCY,
    db: deps.db,
    groupId: env.EVENT_QUEUE_WRITER_GROUP_ID,
    logger,
    queue: deps.queue,
    restartDelayMs: env.EVENT_QUEUE_WRITER_RESTART_DELAY_MS,
  });
  await eventWriter.start();
  logger.info(`Helix Server device event writer consuming ${env.EVENT_QUEUE_TOPIC}.`);

  return async () => {
    await eventWriter.stop();
  };
};
