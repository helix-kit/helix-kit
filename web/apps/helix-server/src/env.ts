import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const DEFAULT_PUBLIC_HTTP_PORT = 4000;
const DEFAULT_DEVICE_MTLS_PORT = 4001;
const DEFAULT_DATA_PLANE_PF_PORT = 4020;
const DEFAULT_EVENT_QUEUE_TOPIC_PARTITIONS = 1;
const DEFAULT_EVENT_QUEUE_WRITER_BATCH_SIZE = 500;
const DEFAULT_EVENT_QUEUE_WRITER_CONCURRENCY = 1;
const DEFAULT_EVENT_QUEUE_CONSUMER_MAX_WAIT_MS = 500;
const DEFAULT_EVENT_QUEUE_WRITER_RESTART_DELAY_MS = 5000;
const DEFAULT_EVENT_QUEUE_MQTT_SESSION_EXPIRY_SECONDS = 86_400;
const DEFAULT_EVENT_QUEUE_PRODUCE_BATCH_SIZE = 500;
const DEFAULT_EVENT_QUEUE_PRODUCE_FLUSH_MS = 5;

const DEFAULT_WORKFLOW_PORT = 4002;
const DEFAULT_WORKFLOW_CONCURRENCY = 50;
const DEFAULT_WORKFLOW_QUERY_MS = 20;
const DEFAULT_WORKFLOW_LLM_MS = 5000;
const DEFAULT_WORKFLOW_NOTIFY_MS = 30;
const DEFAULT_WORKFLOW_GATE_THRESHOLD = 0;

export const env = createEnv({
  server: {
    DATABASE_URL: z.string(),

    HELIX_HTTP_PORT: z.coerce.number().int().positive().default(DEFAULT_PUBLIC_HTTP_PORT),
    DEVICE_MTLS_PORT: z.coerce.number().int().positive().default(DEFAULT_DEVICE_MTLS_PORT),
    // Raw-TCP port for the port-forward proxy (Caddy `*.port.<domain>` → here).
    HELIX_DATA_PLANE_PF_PORT: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_DATA_PLANE_PF_PORT),

    HELIX_SERVER_ROLES: z.string().optional(),

    // JSON seed for the experimental device-login authorization provider. Absent
    // means every device login is denied, so a production server that has not
    // opted in cannot authorize anyone by accident.
    DEVICE_AUTH_FIXTURE: z.string().optional(),

    EVENT_QUEUE_BROKERS: z.string(),
    EVENT_QUEUE_TOPIC: z.string(),
    EVENT_QUEUE_CLIENT_ID: z.string().default('helix-server'),
    EVENT_QUEUE_WRITER_GROUP_ID: z.string().default('helix-device-event-writer'),
    EVENT_QUEUE_MQTT_CLIENT_ID: z.string().default('helix-server-event-ingestion'),
    EVENT_QUEUE_TOPIC_PARTITIONS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_EVENT_QUEUE_TOPIC_PARTITIONS),
    EVENT_QUEUE_WRITER_BATCH_SIZE: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_EVENT_QUEUE_WRITER_BATCH_SIZE),
    EVENT_QUEUE_WRITER_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_EVENT_QUEUE_WRITER_CONCURRENCY),
    EVENT_QUEUE_CONSUMER_MAX_WAIT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_EVENT_QUEUE_CONSUMER_MAX_WAIT_MS),
    EVENT_QUEUE_WRITER_RESTART_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_EVENT_QUEUE_WRITER_RESTART_DELAY_MS),
    EVENT_QUEUE_MQTT_SESSION_EXPIRY_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_EVENT_QUEUE_MQTT_SESSION_EXPIRY_SECONDS),
    EVENT_QUEUE_PRODUCE_BATCH_SIZE: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_EVENT_QUEUE_PRODUCE_BATCH_SIZE),
    EVENT_QUEUE_PRODUCE_FLUSH_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_EVENT_QUEUE_PRODUCE_FLUSH_MS),

    INNGEST_BASE_URL: z.string().default('http://127.0.0.1:8288'),
    INNGEST_EVENT_KEY: z.string().optional(),
    INNGEST_SIGNING_KEY: z.string().optional(),
    // 'inngest' = durable engine; 'direct' = inline no engine; 'dbos' = in-process DBOS Transact.
    HELIX_WORKFLOW_MODE: z.enum(['inngest', 'direct', 'dbos']).default('inngest'),
    // DBOS system database (checkpoint store) URL, for HELIX_WORKFLOW_MODE=dbos.
    DBOS_SYSTEM_DATABASE_URL: z.string().optional(),
    // '1' => migrate the DBOS system schema then exit (run once before a fleet of dispatchers).
    HELIX_DBOS_MIGRATE: z.string().optional(),
    // Postgres schema for DBOS's system tables; per-process distinct schemas shard contention.
    HELIX_DBOS_SCHEMA: z.string().optional(),
    HELIX_WORKFLOW_PORT: z.coerce.number().int().positive().default(DEFAULT_WORKFLOW_PORT),
    // The URL the self-hosted Inngest server calls back on; defaults to loopback.
    HELIX_WORKFLOW_SERVE_HOST: z.string().optional(),
    HELIX_WORKFLOW_DISPATCH_GROUP: z.string().default('helix-workflow-dispatch'),
    HELIX_WORKFLOW_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_WORKFLOW_CONCURRENCY),
    HELIX_WORKFLOW_QUERY_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(DEFAULT_WORKFLOW_QUERY_MS),
    HELIX_WORKFLOW_LLM_MS: z.coerce.number().int().nonnegative().default(DEFAULT_WORKFLOW_LLM_MS),
    HELIX_WORKFLOW_NOTIFY_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(DEFAULT_WORKFLOW_NOTIFY_MS),
    HELIX_WORKFLOW_GATE_THRESHOLD: z.coerce.number().int().default(DEFAULT_WORKFLOW_GATE_THRESHOLD),
    // 'blocking' = fake in-worker sleep; 'infer' = step.ai.infer (Inngest parks the run).
    HELIX_WORKFLOW_LLM_MODE: z.enum(['blocking', 'infer']).default('blocking'),
    HELIX_WORKFLOW_INFER_BASE_URL: z.string().optional(),
    HELIX_WORKFLOW_INFER_MODEL: z.string().default('fake'),

    MQTT_BROKER_URL: z.string().default('mqtt://localhost:1883'),
    MQTT_TLS_CA_CERT_PATH: z.string().optional(),
    MQTT_TLS_CLIENT_CERT_PATH: z.string().optional(),
    MQTT_TLS_CLIENT_KEY_PATH: z.string().optional(),
    MQTT_TLS_SERVER_NAME: z.string().optional(),

    MQTT_STEP_CA_URL: z.string(),
    MQTT_STEP_CA_ROOT_CERT_PATH: z.string(),
    MQTT_STEP_CA_DEVICE_PROVISIONER_NAME: z.string(),
    MQTT_STEP_CA_DEVICE_PROVISIONER_JWK_PATH: z.string(),

    DEVICE_MTLS_CA_CERT_PATH: z.string(),
    DEVICE_MTLS_SERVER_CERT_PATH: z.string(),
    DEVICE_MTLS_SERVER_KEY_PATH: z.string(),
    // Device-cert revocation on the mTLS listener is enforced at the app layer, not via
    // a CRL: a CRL in the TLS context corrupts peer-cert reads on Node 24 / OpenSSL 3.5.

    STORAGE_PROVIDER: z.enum(['AZURE', 'FS', 'MINIO', 'S3']).default('FS'),
    FS_STORAGE_ROOT: z.string().default('/var/lib/helix/storage'),
    FS_STORAGE_SIGNING_SECRET: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().min(1).optional(),
    PUBLIC_APP_URL: z.string().optional(),
    NEXT_PUBLIC_BASE_URL: z.string().optional(),

    AZURE_STORAGE_ACCOUNT_KEY: z.string().optional(),
    AZURE_STORAGE_ACCOUNT_NAME: z.string().optional(),
    AZURE_STORAGE_CONTAINER_NAME: z.string().optional(),

    MINIO_ACCESS_KEY: z.string().default('minioadmin'),
    MINIO_BUCKET_NAME: z.string().default('helix-local'),
    MINIO_REGION: z.string().default('us-east-1'),
    MINIO_SECRET_KEY: z.string().default('minioadmin'),
    MINIO_ENDPOINT: z.string().url().optional(),

    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_BUCKET_NAME: z.string().optional(),
    AWS_REGION: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET_NAME: z.string().optional(),
    S3_ENDPOINT: z.string().url().optional(),
  },

  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
