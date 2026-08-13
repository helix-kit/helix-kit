import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { type Server as HttpsServer } from 'node:https';

import {
  createOtaPublisher,
  createUpgradeRouter,
  type StorageProvider,
  createStorageProviderFromEnv,
  handleFsStorageRequest,
  pkiRouter,
  releasesApiRouter,
  startDataPlane,
  startMqttGatewayBridge,
  type DatabaseClient,
  type DeviceEventQueue,
  type FsStorageHttpOptions,
  type StepCaSettings,
} from '@helix-hq/backend';
import { fileRouter, type DeviceMtlsContext } from '@helix-hq/backend/device-mtls/fileRouter';
import {
  certSerialFromSocket,
  createDeviceMtlsServer,
  deviceIdFromSocket,
  isDeviceCertRevoked,
  readDeviceMtlsMaterial,
  type DeviceMtlsMaterial,
} from '@helix-hq/backend/device-mtls/tls';
import { createRootRouter, TRPCError } from '@helix-hq/backend/trpc';
import { logger } from '@helix-hq/logger';
import { createOpenApiHttpHandler } from 'trpc-to-openapi';

import { type RoleCloser } from './roles';

import type { MqttClient } from 'mqtt/mqtt';

import { env } from '../env';
import { closeServer, listen, toHeaders } from '../http';
import { buildMqttClient, closeMqttClient } from '../mqtt';

const resolveFsSigningSecret = (): string => {
  const secret = env.FS_STORAGE_SIGNING_SECRET ?? env.BETTER_AUTH_SECRET;
  if (secret === undefined) {
    throw new Error(
      'FS_STORAGE_SIGNING_SECRET or BETTER_AUTH_SECRET is required when STORAGE_PROVIDER=FS.',
    );
  }
  return secret;
};

const buildMTLSServer = ({
  db,
  queue,
  storageProvider,
  material,
}: {
  db: DatabaseClient;
  queue: DeviceEventQueue;
  storageProvider: StorageProvider;
  material: DeviceMtlsMaterial;
}): HttpsServer => {
  const createMtlsContext = async (res: ServerResponse): Promise<DeviceMtlsContext> => {
    const deviceId = deviceIdFromSocket(res.socket);
    if (deviceId === null) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Client certificate identity missing.',
      });
    }
    // App-layer revocation (the CRL can't live in the TLS context — see tls.ts).
    const serial = certSerialFromSocket(res.socket);
    if (serial === null || (await isDeviceCertRevoked(db, serial))) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Client certificate is revoked or unrecognized.',
      });
    }
    return { db, deviceId, eventQueue: queue, storageProvider };
  };
  const mtlsHandler = createOpenApiHttpHandler({
    router: createRootRouter({ file: fileRouter }).router,
    createContext: ({ res }) => createMtlsContext(res),
  });
  return createDeviceMtlsServer(material, (request, response) => {
    void mtlsHandler(request, response);
  });
};

const buildPublicServer = async ({
  db,
  mqttClient,
  storageProvider,
}: {
  db: DatabaseClient;
  mqttClient: MqttClient;
  storageProvider: StorageProvider;
}) => {
  const stepCaSettings: StepCaSettings = {
    caRootCertPath: env.MQTT_STEP_CA_ROOT_CERT_PATH,
    caUrl: env.MQTT_STEP_CA_URL,
    deviceProvisionerJwkPath: env.MQTT_STEP_CA_DEVICE_PROVISIONER_JWK_PATH,
    deviceProvisionerName: env.MQTT_STEP_CA_DEVICE_PROVISIONER_NAME,
  };
  const publishOta = createOtaPublisher(mqttClient, db);

  const { router: apiRouter } = createRootRouter({ pki: pkiRouter, releases: releasesApiRouter });
  const apiHandler = createOpenApiHttpHandler({
    router: apiRouter,
    createContext: ({ req }) => ({
      db,
      headers: toHeaders(req.headers),
      publishOta,
      stepCaSettings,
      storage: storageProvider,
    }),
  });
  const fsStorage: FsStorageHttpOptions | null =
    env.STORAGE_PROVIDER === 'FS'
      ? { root: env.FS_STORAGE_ROOT, signingSecret: resolveFsSigningSecret() }
      : null;

  const handleApiRequest = (request: IncomingMessage, response: ServerResponse): void => {
    void apiHandler(request, response);
  };

  const publicRequestHandler = (request: IncomingMessage, response: ServerResponse): void => {
    const routed =
      fsStorage === null
        ? Promise.resolve(false)
        : handleFsStorageRequest(fsStorage, request, response);
    routed
      .then((handled) => {
        if (!handled) {
          handleApiRequest(request, response);
        }
        return undefined;
      })
      .catch((error: unknown) => {
        response.destroy(error instanceof Error ? error : new Error('Public request failed'));
      });
  };

  return createHttpServer(publicRequestHandler);
};

export const startGateway = async (deps: {
  db: DatabaseClient;
  queue: DeviceEventQueue;
}): Promise<RoleCloser> => {
  const { db, queue } = deps;
  const storageProvider = createStorageProviderFromEnv(env);
  const mqttClient = await buildMqttClient();

  const publicServer = await buildPublicServer({ db, mqttClient, storageProvider });
  // One upgrade dispatcher so the gateway WS (/ws) and /stream/client share the API port.
  const publicUpgrades = createUpgradeRouter(publicServer);
  const gatewayBridge = await startMqttGatewayBridge({ upgrades: publicUpgrades, mqttClient });

  await listen(publicServer, env.HELIX_HTTP_PORT);
  logger.info(`Helix Server public HTTP listening on ${env.HELIX_HTTP_PORT}.`);

  // The file-transfer router and the data-plane device stream share ONE mTLS listener,
  // so a device reaches everything over a single mTLS endpoint.
  const mtlsMaterial = await readDeviceMtlsMaterial({
    caCertPath: env.DEVICE_MTLS_CA_CERT_PATH,
    serverCertPath: env.DEVICE_MTLS_SERVER_CERT_PATH,
    serverKeyPath: env.DEVICE_MTLS_SERVER_KEY_PATH,
  });

  const mtlsServer = buildMTLSServer({ db, queue, storageProvider, material: mtlsMaterial });
  const deviceUpgrades = createUpgradeRouter(mtlsServer);

  // The data plane attaches /stream/device onto the device mTLS server and /stream/client
  // onto the public server — no port of its own; sessions pair the two by id.
  const dataPlane = await startDataPlane({
    clientUpgrades: publicUpgrades,
    deviceUpgrades,
    isRevoked: (serial) => isDeviceCertRevoked(db, serial),
    portForwardPort: env.HELIX_DATA_PLANE_PF_PORT,
  });

  await listen(mtlsServer, env.DEVICE_MTLS_PORT);
  logger.info(
    `Helix Server device mTLS (file transfer + data plane) listening on ${env.DEVICE_MTLS_PORT}.`,
  );

  return async () => {
    await dataPlane.close();
    deviceUpgrades.close();
    await closeServer(mtlsServer);
    await gatewayBridge.close();
    publicUpgrades.close();
    await closeServer(publicServer);
    await closeMqttClient(mqttClient);
  };
};
