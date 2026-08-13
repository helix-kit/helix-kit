import {
  buildWorkflowTrigger,
  DEVICE_EVENT_WORKFLOW,
  initDbosWorkflow,
  parseDeviceEventEnvelope,
  runWorkflowDbos,
  runWorkflowDirect,
  shutdownDbosWorkflow,
  WORKFLOW_EVENT_NAME,
  type DatabaseClient,
  type DeviceEventQueue,
  type WorkflowRunOutcome,
  type WorkflowTriggerData,
} from '@helix-hq/backend';
import { logger } from '@helix-hq/logger';

import { type RoleCloser } from './roles';
import { buildInngestClient, buildWorkflowDeps } from './workflow-runtime';

import type { KafkaMessage } from 'kafkajs';

import { env } from '../env';

const HEARTBEAT_EVERY = 32;
const BACKPRESSURE_POLL_MS = 3;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const messageToTrigger = (message: KafkaMessage): WorkflowTriggerData | null => {
  const deviceId = message.key?.toString('utf8').trim();
  if (deviceId === undefined || deviceId === '') {
    return null;
  }
  const envelope = parseDeviceEventEnvelope(message.value?.toString('utf8') ?? '');
  if (envelope?.msgId === undefined || envelope.msgId.trim() === '') {
    return null;
  }
  return buildWorkflowTrigger({
    deviceId,
    messageId: envelope.msgId,
    payload: envelope.payload,
  });
};

// The dispatch role turns ingested device events into workflow runs: 'inngest' forwards to the durable engine; 'direct'/'dbos' run the graph in-process under a bounded worker pool ('direct' non-durable, 'dbos' checkpoints to Postgres).
export const startDispatch = async (deps: {
  db: DatabaseClient;
  queue: DeviceEventQueue;
}): Promise<RoleCloser> => {
  const mode = env.HELIX_WORKFLOW_MODE;
  const limit = env.HELIX_WORKFLOW_CONCURRENCY;
  const inngest = mode === 'inngest' ? buildInngestClient() : null;
  const inline = mode === 'direct' || mode === 'dbos';
  const workflowDeps = inline ? buildWorkflowDeps(deps.db) : null;

  if (mode === 'dbos') {
    if (env.DBOS_SYSTEM_DATABASE_URL === undefined) {
      throw new Error('dbos mode requires DBOS_SYSTEM_DATABASE_URL.');
    }
    if (workflowDeps === null) {
      throw new Error('dbos mode requires workflow deps.');
    }
    await initDbosWorkflow({
      systemDatabaseUrl: env.DBOS_SYSTEM_DATABASE_URL,
      systemDatabaseSchema: env.HELIX_DBOS_SCHEMA,
      deps: workflowDeps,
    });
  }

  const consumer = deps.queue.createConsumer(env.HELIX_WORKFLOW_DISPATCH_GROUP);
  let inFlight = 0;
  let stopped = false;

  await consumer.connect();
  await consumer.subscribe({ fromBeginning: false, topic: deps.queue.topic });

  await consumer.run({
    eachBatchAutoResolve: true,
    eachBatch: async ({ batch, heartbeat, isRunning, isStale }) => {
      if (mode === 'inngest' && inngest !== null) {
        const events = batch.messages
          .map(messageToTrigger)
          .filter((trigger): trigger is WorkflowTriggerData => trigger !== null)
          .map((data) => ({ data, name: WORKFLOW_EVENT_NAME }));
        if (events.length > 0) {
          await inngest.send(events);
        }
        await heartbeat();
        return;
      }

      if (workflowDeps === null) {
        return;
      }
      for (let index = 0; index < batch.messages.length; index += 1) {
        if (!isRunning() || isStale()) {
          return;
        }
        const message = batch.messages[index];
        const trigger = message === undefined ? null : messageToTrigger(message);
        if (trigger !== null) {
          while (inFlight >= limit && !stopped) {
            await sleep(BACKPRESSURE_POLL_MS);
            await heartbeat();
          }
          inFlight += 1;
          const run: Promise<WorkflowRunOutcome> =
            mode === 'dbos'
              ? runWorkflowDbos(trigger)
              : runWorkflowDirect({
                  graph: DEVICE_EVENT_WORKFLOW,
                  data: trigger,
                  deps: workflowDeps,
                });
          void run
            .catch((error: unknown) => {
              logger.error('workflow in-process run failed', { error });
            })
            .finally(() => {
              inFlight -= 1;
            });
        }
        if (index % HEARTBEAT_EVERY === 0) {
          await heartbeat();
        }
      }
      await heartbeat();
    },
  });

  logger.info(
    `Helix Server workflow dispatch consuming ${deps.queue.topic} ` +
      `(mode=${mode}, group=${env.HELIX_WORKFLOW_DISPATCH_GROUP}).`,
  );

  return async () => {
    stopped = true;
    await consumer.disconnect();
    if (mode === 'dbos') {
      await shutdownDbosWorkflow();
    }
  };
};
