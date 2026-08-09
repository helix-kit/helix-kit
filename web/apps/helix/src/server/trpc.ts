/* eslint-disable import/max-dependencies -- composing every feature's router is
   this module's entire job, so the ordinary cap does not apply. */
import 'server-only';

import { accountRouter } from '@helix/backend/account';
import { findAgentUser } from '@helix/backend/agent';
import { aiUsageRouter } from '@helix/backend/ai-usage';
import { conversationsRouter } from '@helix/backend/conversations';
import { devicesAdminRouter } from '@helix/backend/devices';
import { featuresAdminRouter } from '@helix/backend/features';
import { iceRouter, type TurnSettings } from '@helix/backend/ice';
import { deviceCertificatesAdminRouter } from '@helix/backend/pki/admin-router';
import { profilesAdminRouter } from '@helix/backend/profiles';
import { releasesAdminRouter } from '@helix/backend/releases';
import { createRootRouter } from '@helix/backend/trpc';
import { usersAdminRouter } from '@helix/backend/users';
import {
  blogAdminRouter,
  blogPublicRouter,
  type BlogContext,
  type BlogSessionUser,
} from '@helix/blog/server';
import { espFlasherRouter } from '@helix/device-apps/esp32-flasher/router';
import { reportTemplatesRouter } from '@helix/pdf-report/backend';

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
  // Feature packages declare the keys their own client components resolve them by
  // (`BLOG_ADMIN_ROUTER_KEY` / `BLOG_PUBLIC_ROUTER_KEY` in @helix/blog). Spelled as
  // literals here, not as those constants: the tRPC usage analyzer skips routers with
  // computed property names, which would drop every blog procedure from the report.
  blog: blogAdminRouter,
  reportTemplates: reportTemplatesRouter,
  blogPublic: blogPublicRouter,
  releases: releasesAdminRouter,
  devices: devicesAdminRouter,
  users: usersAdminRouter,
  profiles: profilesAdminRouter,
  features: featuresAdminRouter,
  espFlasher: espFlasherRouter,
  deviceCertificates: deviceCertificatesAdminRouter,
  ice: iceRouter,
  // One store, mounted per surface. The surface is bound here rather than sent
  // by the client, so a feature cannot list or delete another's threads.
  conversations: conversationsRouter({ surface: 'assistant' }),
  reportConversations: conversationsRouter({ surface: 'pdf-report' }),
  aiUsage: aiUsageRouter,
  account: accountRouter,
});
export type AppRouter = typeof appRouter;

type CreateTRPCContextOptions = {
  headers: Headers;
  setHeader: (key: string, value: string) => Promise<void>;
};

// One place assembles the full request context so both the cookie-session path
// (createTRPCContext) and the token path (createTRPCContextForUser, used by the
// external MCP server) produce an identical context shape.
const buildContext = (user: BlogSessionUser | null) =>
  ({
    db,
    adminRoles: ADMIN_ROLES,
    user,
    storage,
    stepCaSettings,
    stunUrls: urlList(env.STUN_SERVER_URL),
    turn: turnSettings,
    buildWorkerUrl: env.HELIX_BUILD_WORKER_URL ?? null,
    buildCallbackBaseUrl: env.HELIX_BUILD_CALLBACK_BASE_URL ?? null,
  }) satisfies BlogContext & {
    storage: typeof storage;
    stepCaSettings: StepCaSettings | null;
    stunUrls: readonly string[];
    turn: TurnSettings | null;
    buildWorkerUrl: string | null;
    buildCallbackBaseUrl: string | null;
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

  return buildContext(user);
};

/**
 * Build a request context for an already-authenticated user id (no cookie session)
 * — used by the external MCP server, which authenticates via OAuth bearer token or
 * an API key and then needs the same context so each procedure's own authz runs.
 */
export const createTRPCContextForUser = async (userId: string) => {
  const user = await findAgentUser(db, userId);
  return buildContext(user);
};
