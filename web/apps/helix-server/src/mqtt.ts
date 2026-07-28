import { readFile } from 'node:fs/promises';

import mqtt from 'mqtt';

import { env } from './env';

const MQTT_PROTOCOL_VERSION_5 = 5;
const MQTT_RECONNECT_PERIOD_MS = 5000;

const readOptionalFile = async (path: string | undefined): Promise<Buffer | undefined> =>
  path === undefined ? undefined : readFile(path);

const readMqttTls = async (): Promise<Pick<mqtt.IClientOptions, 'ca' | 'cert' | 'key'>> => {
  const [ca, cert, key] = await Promise.all([
    readOptionalFile(env.MQTT_TLS_CA_CERT_PATH),
    readOptionalFile(env.MQTT_TLS_CLIENT_CERT_PATH),
    readOptionalFile(env.MQTT_TLS_CLIENT_KEY_PATH),
  ]);
  return { ca, cert, key };
};

// The gateway control plane uses a clean (non-durable) session: unrouted
// command/response traffic has no value once the process is gone.
export const buildMqttClient = async (): Promise<mqtt.MqttClient> => {
  const tls = await readMqttTls();
  return mqtt.connect(env.MQTT_BROKER_URL, {
    ...tls,
    clean: true,
    clientId: `helix-server-${process.pid}`,
    servername: env.MQTT_TLS_SERVER_NAME,
  });
};

// Durable ingestion uses a persistent MQTT 5 session so the broker queues events
// published while helix-server is briefly offline and redelivers them on
// reconnect. Redelivered events dedupe on (device_id, message_id) downstream.
export const buildEventIngestionMqttClient = async (): Promise<mqtt.MqttClient> => {
  const tls = await readMqttTls();
  return mqtt.connect(env.MQTT_BROKER_URL, {
    ...tls,
    clean: false,
    clientId: env.EVENT_QUEUE_MQTT_CLIENT_ID,
    properties: { sessionExpiryInterval: env.EVENT_QUEUE_MQTT_SESSION_EXPIRY_SECONDS },
    protocolVersion: MQTT_PROTOCOL_VERSION_5,
    reconnectPeriod: MQTT_RECONNECT_PERIOD_MS,
    resubscribe: false,
    servername: env.MQTT_TLS_SERVER_NAME,
  });
};

export const closeMqttClient = (client: mqtt.MqttClient): Promise<void> =>
  new Promise((resolve) => {
    client.end(true, {}, () => {
      resolve();
    });
  });

export const parseBrokers = (value: string): string[] =>
  value
    .split(',')
    .map((broker) => broker.trim())
    .filter((broker) => broker !== '');
