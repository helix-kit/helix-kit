import { randomUUID } from 'node:crypto';

import { type Logger } from '@helix/logger';

import { parseDeviceEventEnvelope } from './topic';

import type { DeviceEventQueue } from './queue';
import type {
  Consumer,
  ConsumerCrashEvent,
  KafkaMessage,
  RemoveInstrumentationEventListener,
} from 'kafkajs';

import { type DatabaseClient } from '../db';
import { deviceEvent } from '../db/schema';

export type DeviceEventWriterOptions = Readonly<{
  db: DatabaseClient;
  queue: DeviceEventQueue;
  groupId: string;
  batchSize: number;
  restartDelayMs: number;
  // Partitions processed concurrently; >1 overlaps DB-insert/offset-commit waits instead of stalling on serial I/O.
  concurrency?: number;
  logger: Logger;
}>;

const DEFAULT_CONCURRENCY = 1;

const OFFSET_INCREMENT = 1n;
const incrementOffset = (offset: string): string => (BigInt(offset) + OFFSET_INCREMENT).toString();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const normalizeOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const parseEventTimestamp = (value: string | null): Date | null => {
  if (value === null) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

type KafkaHeaderValue = Buffer | string | (Buffer | string)[] | undefined;

const headerValue = (value: KafkaHeaderValue): string | null => {
  const single = Array.isArray(value) ? value[0] : value;
  return single === undefined ? null : normalizeOptionalString(single.toString());
};

const toRow = (message: KafkaMessage): typeof deviceEvent.$inferInsert | null => {
  const deviceId = normalizeOptionalString(message.key?.toString('utf8'));
  const receivedAt = headerValue(message.headers?.receivedAt);
  const envelope = parseDeviceEventEnvelope(message.value?.toString('utf8') ?? '');
  if (deviceId === null || receivedAt === null || envelope === null) {
    return null;
  }
  const messageId = normalizeOptionalString(envelope.msgId);
  if (messageId === null) {
    return null;
  }
  return {
    deviceId,
    eventPayload: envelope.payload ?? {},
    eventTimestamp: parseEventTimestamp(normalizeOptionalString(envelope.timestamp)),
    eventType: envelope.type,
    id: randomUUID(),
    messageId,
    receivedAt: new Date(receivedAt),
  };
};

// Consumes queued device events into device_event. Offsets commit only after persisting, so an interrupted write is redelivered and deduped via the (device_id, message_id) unique constraint.
export class DeviceEventWriter {
  private readonly db: DatabaseClient;
  private readonly queue: DeviceEventQueue;
  private readonly groupId: string;
  private readonly batchSize: number;
  private readonly restartDelayMs: number;
  private readonly concurrency: number;
  private readonly logger: Logger;
  private consumer: Consumer | null = null;
  private removeCrashListener: RemoveInstrumentationEventListener<'consumer.crash'> | null = null;
  private runPromise: Promise<void> | null = null;
  private restartPromise: Promise<void> | null = null;
  private stopped = false;

  constructor(options: DeviceEventWriterOptions) {
    this.db = options.db;
    this.queue = options.queue;
    this.groupId = options.groupId;
    this.batchSize = options.batchSize;
    this.restartDelayMs = options.restartDelayMs;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.logger = options.logger;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.startConsumer();
  }

  private async writeChunk(rows: Array<typeof deviceEvent.$inferInsert>): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.db
      .insert(deviceEvent)
      .values(rows)
      .onConflictDoNothing({ target: [deviceEvent.deviceId, deviceEvent.messageId] });
  }

  private async startConsumer(): Promise<void> {
    const consumer = this.queue.createConsumer(this.groupId);
    const removeCrashListener = consumer.on(consumer.events.CRASH, (event: ConsumerCrashEvent) => {
      if (this.stopped || event.payload.restart || this.consumer !== consumer) {
        return;
      }
      if (this.restartPromise !== null) {
        return;
      }
      this.restartPromise = this.restartConsumer(event.payload.error).finally(() => {
        this.restartPromise = null;
      });
    });

    this.consumer = consumer;
    this.removeCrashListener = removeCrashListener;

    try {
      await consumer.connect();
      await consumer.subscribe({ fromBeginning: false, topic: this.queue.topic });

      this.runPromise = consumer
        .run({
          autoCommit: false,
          eachBatchAutoResolve: false,
          partitionsConsumedConcurrently: this.concurrency,
          eachBatch: async ({ batch, heartbeat, isRunning, isStale, resolveOffset }) => {
            for (let start = 0; start < batch.messages.length; start += this.batchSize) {
              if (!isRunning() || isStale()) {
                return;
              }
              const chunk = batch.messages.slice(start, start + this.batchSize);
              const rows: Array<typeof deviceEvent.$inferInsert> = [];
              for (const message of chunk) {
                const row = toRow(message);
                if (row === null) {
                  this.logger.warn('Dropping malformed queued device event', {
                    offset: message.offset,
                    partition: batch.partition,
                  });
                  continue;
                }
                rows.push(row);
              }

              await this.writeChunk(rows);

              const lastMessage = chunk.at(-1);
              if (lastMessage !== undefined) {
                for (const message of chunk) {
                  resolveOffset(message.offset);
                }
                await consumer.commitOffsets([
                  {
                    offset: incrementOffset(lastMessage.offset),
                    partition: batch.partition,
                    topic: batch.topic,
                  },
                ]);
              }
              await heartbeat();
            }
          },
        })
        .catch((error: unknown) => {
          if (!this.stopped && this.consumer === consumer) {
            this.logger.error('Device event writer run loop crashed', { error });
          }
        });
    } catch (error) {
      if (this.consumer === consumer) {
        this.consumer = null;
        this.removeCrashListener = null;
        this.runPromise = null;
      }
      removeCrashListener();
      await consumer.disconnect().catch(() => undefined);
      throw error;
    }
  }

  private async restartConsumer(error: Error): Promise<void> {
    this.logger.error('Restarting device event writer after consumer crash', { error });
    await this.shutdownConsumer();

    while (!this.stopped) {
      await sleep(this.restartDelayMs);
      try {
        await this.startConsumer();
        return;
      } catch (restartError) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this.stopped may be flipped by stop() during the async restart
        if (this.stopped) {
          return;
        }
        this.logger.error('Device event writer restart attempt failed', { error: restartError });
      }
    }
  }

  private async shutdownConsumer(): Promise<void> {
    const { consumer, removeCrashListener, runPromise } = this;
    this.consumer = null;
    this.removeCrashListener = null;
    this.runPromise = null;

    removeCrashListener?.();
    if (consumer === null) {
      return;
    }
    await consumer.stop().catch(() => undefined);
    await runPromise?.catch(() => undefined);
    await consumer.disconnect().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.shutdownConsumer();
    await this.restartPromise?.catch(() => undefined);
  }
}
