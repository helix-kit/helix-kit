import {
  createDatabasePool,
  createDb,
  DeviceEventQueue,
  initDbosWorkflow,
  shutdownDbosWorkflow,
} from '@helix/backend';
import { logger } from '@helix/logger';

import { env } from './env';
import { parseBrokers } from './mqtt';
import {
  parseRoles,
  startDispatch,
  startGateway,
  startIngest,
  startWorkflow,
  startWriter,
  type RoleCloser,
} from './roles';
import { buildWorkflowDeps } from './roles/workflow-runtime';

// Migrate DBOS's system schema once, then exit; run before a fleet of dispatch processes so they don't race the migration (deadlocks in Postgres).
const migrateDbosAndExit = async (): Promise<void> => {
  if (env.DBOS_SYSTEM_DATABASE_URL === undefined) {
    throw new Error('HELIX_DBOS_MIGRATE requires DBOS_SYSTEM_DATABASE_URL.');
  }
  const pool = createDatabasePool({ connectionString: env.DATABASE_URL });
  const db = createDb({ pool });
  await initDbosWorkflow({
    systemDatabaseUrl: env.DBOS_SYSTEM_DATABASE_URL,
    systemDatabaseSchema: env.HELIX_DBOS_SCHEMA,
    deps: buildWorkflowDeps(db),
  });
  await shutdownDbosWorkflow();
  await pool.end();
  logger.info('DBOS system schema migrated.');
  process.exit(0);
};

const start = async (): Promise<{ close: () => Promise<void> }> => {
  const roles = parseRoles(env.HELIX_SERVER_ROLES);
  logger.info(`Helix Server roles: ${[...roles].join(', ')}.`);

  const closers: RoleCloser[] = [];

  const needsDb =
    roles.has('gateway') || roles.has('writer') || roles.has('workflow') || roles.has('dispatch');
  const dbPool = needsDb ? createDatabasePool({ connectionString: env.DATABASE_URL }) : null;
  const db = dbPool === null ? null : createDb({ pool: dbPool });
  if (dbPool !== null) {
    closers.push(() => dbPool.end());
  }

  // Gateway and ingest produce, writer consumes; co-located roles share one queue instance, split roles coordinate through Kafka on the same topic.
  const producerNeeded = roles.has('gateway') || roles.has('ingest');
  const needsQueue = producerNeeded || roles.has('writer') || roles.has('dispatch');
  const eventQueue = needsQueue
    ? new DeviceEventQueue({
        brokers: parseBrokers(env.EVENT_QUEUE_BROKERS),
        clientId: env.EVENT_QUEUE_CLIENT_ID,
        consumerMaxWaitMs: env.EVENT_QUEUE_CONSUMER_MAX_WAIT_MS,
        topic: env.EVENT_QUEUE_TOPIC,
        topicPartitions: env.EVENT_QUEUE_TOPIC_PARTITIONS,
      })
    : null;
  if (eventQueue !== null) {
    await eventQueue.start({ connectProducer: producerNeeded });
    closers.push(() => eventQueue.stop());
  }

  if (roles.has('gateway')) {
    if (db === null || eventQueue === null) {
      throw new Error('gateway role requires a database connection and event queue.');
    }
    closers.push(await startGateway({ db, queue: eventQueue }));
  }

  if (roles.has('writer')) {
    if (db === null || eventQueue === null) {
      throw new Error('writer role requires a database connection and event queue.');
    }
    closers.push(await startWriter({ db, queue: eventQueue }));
  }

  if (roles.has('ingest')) {
    if (eventQueue === null) {
      throw new Error('ingest role requires an event queue.');
    }
    closers.push(await startIngest({ queue: eventQueue }));
  }

  if (roles.has('workflow')) {
    if (db === null) {
      throw new Error('workflow role requires a database connection.');
    }
    closers.push(await startWorkflow({ db }));
  }

  if (roles.has('dispatch')) {
    if (db === null || eventQueue === null) {
      throw new Error('dispatch role requires a database connection and event queue.');
    }
    closers.push(await startDispatch({ db, queue: eventQueue }));
  }

  return {
    close: async () => {
      for (const closeResource of [...closers].reverse()) {
        await closeResource();
      }
    },
  };
};

if (env.HELIX_DBOS_MIGRATE === '1') {
  await migrateDbosAndExit();
}

const runtime = await start();

const shutdown = (): void => {
  runtime
    .close()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error('Helix Server shutdown failed', { error });
      process.exit(1);
    });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
