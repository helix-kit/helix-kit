import { Kafka, logLevel, type Consumer, type Producer } from 'kafkajs';

export type RawDeviceEvent = Readonly<{
  deviceId: string;
  receivedAt: string;
  payload: Buffer | string;
}>;

export type DeviceEventQueueOptions = Readonly<{
  brokers: string[];
  clientId: string;
  topic: string;
  topicPartitions: number;
  consumerMaxWaitMs: number;
  idempotent?: boolean;
  maxInFlightRequests?: number;
  logLevel?: logLevel;
}>;

const PRODUCER_RETRIES = 10;
const CONSUMER_RETRIES = 10;
const REPLICATION_FACTOR = 1;
const ACKS_ALL = -1;
// Dedupe is enforced by the (device_id, message_id) constraint at insert time,
// so the producer does not need idempotency; dropping it lets sends pipeline.
const DEFAULT_MAX_IN_FLIGHT = 5;

export class DeviceEventQueue {
  private readonly kafka: Kafka;
  private producer: Producer | null = null;

  constructor(private readonly options: DeviceEventQueueOptions) {
    this.kafka = new Kafka({
      brokers: options.brokers,
      clientId: options.clientId,
      logLevel: options.logLevel ?? logLevel.WARN,
    });
  }

  get topic(): string {
    return this.options.topic;
  }

  // A consumer-only (writer) process still needs the topic to exist but never
  // produces, so `connectProducer: false` lets it skip an idle producer socket.
  async start(options?: { connectProducer?: boolean }): Promise<void> {
    if (this.options.brokers.length === 0) {
      throw new Error('DeviceEventQueue requires at least one broker.');
    }

    const admin = this.kafka.admin();
    await admin.connect();
    try {
      const topics = await admin.listTopics();
      if (!topics.includes(this.options.topic)) {
        await admin.createTopics({
          topics: [
            {
              numPartitions: this.options.topicPartitions,
              replicationFactor: REPLICATION_FACTOR,
              topic: this.options.topic,
            },
          ],
          waitForLeaders: true,
        });
      }
    } finally {
      await admin.disconnect();
    }

    if (options?.connectProducer ?? true) {
      this.producer = this.kafka.producer({
        allowAutoTopicCreation: false,
        idempotent: this.options.idempotent ?? false,
        maxInFlightRequests: this.options.maxInFlightRequests ?? DEFAULT_MAX_IN_FLIGHT,
        retry: { retries: PRODUCER_RETRIES },
      });
      await this.producer.connect();
    }
  }

  async stop(): Promise<void> {
    await this.producer?.disconnect();
    this.producer = null;
  }

  async publish(event: RawDeviceEvent): Promise<void> {
    await this.publishBatch([event]);
  }

  async publishBatch(events: readonly RawDeviceEvent[]): Promise<void> {
    if (this.producer === null) {
      throw new Error('DeviceEventQueue producer is not connected.');
    }
    if (events.length === 0) {
      return;
    }
    await this.producer.send({
      acks: ACKS_ALL,
      messages: events.map((event) => ({
        headers: { receivedAt: event.receivedAt },
        key: event.deviceId,
        value: event.payload,
      })),
      topic: this.options.topic,
    });
  }

  createConsumer(groupId: string): Consumer {
    return this.kafka.consumer({
      allowAutoTopicCreation: false,
      groupId,
      maxWaitTimeInMs: this.options.consumerMaxWaitMs,
      retry: { retries: CONSUMER_RETRIES },
    });
  }
}
