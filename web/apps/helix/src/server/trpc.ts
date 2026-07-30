import 'server-only';

import {
  blogAdminRouter,
  blogPublicRouter,
  type BlogContext,
  type BlogSessionUser,
} from '@helix/backend/blog';
import { agentRouter } from '@helix/backend/agent';
import { devicesAdminRouter } from '@helix/backend/devices';
import { featuresAdminRouter } from '@helix/backend/features';
import { iceRouter, type TurnSettings } from '@helix/backend/ice';
import { deviceCertificatesAdminRouter } from '@helix/backend/pki/admin-router';
import { profilesAdminRouter } from '@helix/backend/profiles';
import { releasesAdminRouter } from '@helix/backend/releases';
import { createRootRouter } from '@helix/backend/trpc';
import { usersAdminRouter } from '@helix/backend/users';
import { espFlasherRouter } from '@helix/device-apps/esp32-flasher/router';

import { env } from '@/lib/env';

import { ADMIN_ROLES, auth } from './auth';
import { db } from './db';
import { storage } from './storage';

import type { StepCaSettings } from '@helix/backend/pki/step-ca';

const stepCaSettings: StepCaSettings | null =
  env.MQTT_STEP_CA_URL != null &&
  env.MQTT_STEP_CA_ROOT_CERT_PATH != null &&
  env.MQTT_STEP_CA_DEVICE_PROVISIONER_NAME != null &&
  env.MQTT_STEP_CA_DEVICE_PROVISIONER_JWK_PATH != null
    ? {
        caUrl: env.MQTT_STEP_CA_URL,
        caRootCertPath: env.MQTT_STEP_CA_ROOT_CERT_PATH,
        deviceProvisionerName: env.MQTT_STEP_CA_DEVICE_PROVISIONER_NAME,
        deviceProvisionerJwkPath: env.MQTT_STEP_CA_DEVICE_PROVISIONER_JWK_PATH,
      }
    : null;

const urlList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url !== '');

const turnSettings: TurnSettings | null =
  env.TURN_SERVER_URL != null && env.TURN_STATIC_AUTH_SECRET != null
    ? {
        serverUrls: urlList(env.TURN_SERVER_URL),
        staticAuthSecret: env.TURN_STATIC_AUTH_SECRET,
        ttlSeconds: env.TURN_CREDENTIAL_TTL_SECONDS,
      }
    : null;

export const { router: appRouter } = createRootRouter({
  blog: blogAdminRouter,
  blogPublic: blogPublicRouter,
  releases: releasesAdminRouter,
  devices: devicesAdminRouter,
  users: usersAdminRouter,
  profiles: profilesAdminRouter,
  features: featuresAdminRouter,
  espFlasher: espFlasherRouter,
  deviceCertificates: deviceCertificatesAdminRouter,
  ice: iceRouter,
  agent: agentRouter,
});
export type AppRouter = typeof appRouter;

type CreateTRPCContextOptions = {
  headers: Headers;
  setHeader: (key: string, value: string) => Promise<void>;
};

export const createTRPCContext = async ({ headers }: CreateTRPCContextOptions) => {
  const session = await auth.api.getSession({ headers });
  const sessionUser = session?.user;
  const user: BlogSessionUser | null =
    sessionUser == null
      ? null
      : {
          id: sessionUser.id,
          name: sessionUser.name,
          role: (sessionUser as { role?: string | null }).role ?? null,
        };

  return {
    db,
    adminRoles: ADMIN_ROLES,
    user,
    storage,
    stepCaSettings,
    stunUrls: urlList(env.STUN_SERVER_URL),
    turn: turnSettings,
    buildWorkerUrl: env.HELIX_BUILD_WORKER_URL ?? null,
    buildCallbackBaseUrl: env.HELIX_BUILD_CALLBACK_BASE_URL ?? null,
  } satisfies BlogContext & {
    storage: typeof storage;
    stepCaSettings: StepCaSettings | null;
    stunUrls: readonly string[];
    turn: TurnSettings | null;
    buildWorkerUrl: string | null;
    buildCallbackBaseUrl: string | null;
  };
};
