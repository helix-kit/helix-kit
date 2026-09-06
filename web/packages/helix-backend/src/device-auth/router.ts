import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';

import { type EnrollmentRelay } from './enrollment-relay';
import {
  type DeviceAuthorizationProvider,
  type LoginAuthorization,
  type UnixIdentity,
  type UnixIdentityDirectory,
} from './types';

import type { DatabaseClient } from '../db';

import { session } from '../db/auth-schema';
import { readBearerToken, verifyDeviceIdToken } from '../lib/device';
import { createRouterFactory, TRPCError } from '../trpc';

/**
 * The device-facing authorization API.
 *
 * A device calls this on every login, however the user authenticated. Holding a
 * credential is authentication; it is never permission, so the cloud stays the
 * only authority on whether a login is currently allowed.
 */
export type DeviceAuthContext = Readonly<{
  db: DatabaseClient;
  headers: Headers;
  authorization: DeviceAuthorizationProvider;
  directory: UnixIdentityDirectory;
  enrollments: EnrollmentRelay;
  /** Where the owner goes to approve an enrollment. */
  enrollmentVerificationUri: string;
}>;

const deviceIdInput = z.string().trim().min(1, 'deviceId is required');
const userIdInput = z.string().trim().min(1, 'userId is required');
const sessionTokenInput = z.string().trim().min(1, 'sessionToken is required');

/** What a device is told about a login attempt, whoever asked. */
const decisionOutput = z.object({
  allowed: z.boolean(),
  linuxUid: z.number().int().nullable(),
  policyVersion: z.number().int(),
  scopes: z.array(z.string()),
  username: z.string().nullable(),
  userId: z.string().nullable(),
});

type Decision = z.infer<typeof decisionOutput>;

/** A week is the longest a credential may live, matching the device's own cap. */
const MAX_DURATION_HOURS = 168;

/** What a device learns about an enrollment it started. Never the credential. */
const enrollmentOutput = z.object({
  id: z.string(),
  userCode: z.string(),
  status: z.enum(['pending', 'approved', 'revealed', 'denied', 'expired']),
  userId: z.string().nullable(),
  approvedDurationHours: z.number().int().nullable(),
  verificationUri: z.string(),
});

const DENIED: Decision = {
  allowed: false,
  linuxUid: null,
  policyVersion: 0,
  scopes: [],
  username: null,
  userId: null,
};

/** Combines the two lookups into the single answer a device acts on. */
const decide = (
  userId: string,
  identity: UnixIdentity | null,
  authorization: LoginAuthorization,
): Decision => ({
  // A user with no Unix identity cannot be logged in as anybody, whatever their
  // scopes say.
  allowed: authorization.allowed && identity !== null,
  linuxUid: identity?.linuxUid ?? null,
  policyVersion: authorization.policyVersion,
  scopes: [...authorization.scopes],
  username: identity?.username ?? null,
  userId,
});

export const deviceAuthApiRouter = createRouterFactory<DeviceAuthContext>()((t) => {
  /**
   * Authenticates the calling device by its access token, exactly as the cert
   * enrollment path does. The device proves it is the device; the user identity
   * in the request is an assertion this endpoint then authorizes.
   */
  const deviceProcedure = t.procedure
    .input(z.object({ deviceId: deviceIdInput }))
    .use(async ({ ctx, input, next }) => {
      const accessToken = readBearerToken(ctx.headers);
      if (accessToken === null) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Device access token is missing or invalid.',
        });
      }
      const isValidDeviceToken = await verifyDeviceIdToken(input.deviceId, accessToken, ctx.db);
      if (!isValidDeviceToken) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Device access token is invalid.',
        });
      }
      return next({ ctx });
    });

  return t.router({
    /**
     * For a user the device has already identified: it verified a persistent
     * credential locally and now asks whether that user may still log in.
     */
    authorizeLogin: deviceProcedure
      .meta({ openapi: { method: 'POST', path: '/api/device-auth/authorize' } })
      .input(z.object({ deviceId: deviceIdInput, userId: userIdInput }))
      .output(decisionOutput)
      .mutation(async ({ ctx, input }) => {
        const [identity, authorization] = await Promise.all([
          ctx.directory.lookup(input.userId),
          ctx.authorization.authorize(input.deviceId, input.userId),
        ]);
        return decide(input.userId, identity, authorization);
      }),

    /**
     * For a browser sign-in the device cannot interpret: it holds the session
     * token the device-authorization flow handed back, and the cloud says who
     * that is. The device never asserts an identity here, so approving somebody
     * else's code cannot log anybody else in.
     */
    authorizeSession: deviceProcedure
      .meta({ openapi: { method: 'POST', path: '/api/device-auth/authorize-session' } })
      .input(z.object({ deviceId: deviceIdInput, sessionToken: sessionTokenInput }))
      .output(decisionOutput)
      .mutation(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select({ userId: session.userId })
          .from(session)
          .where(and(eq(session.token, input.sessionToken), gt(session.expiresAt, new Date())))
          .limit(1);

        const row = rows[0];
        if (row === undefined) {
          // An unknown or expired session is not an error the device can act on;
          // it is simply nobody, and nobody may log in.
          return DENIED;
        }

        const [identity, authorization] = await Promise.all([
          ctx.directory.lookup(row.userId),
          ctx.authorization.authorize(input.deviceId, row.userId),
        ]);
        return decide(row.userId, identity, authorization);
      }),

    /**
     * Takes a freshly minted credential so its owner can be shown it once. The
     * plaintext lives only in the relay's memory until then, and never reaches
     * durable storage.
     */
    createEnrollment: deviceProcedure
      .meta({ openapi: { method: 'POST', path: '/api/device-auth/enrollment' } })
      .input(
        z.object({
          deviceId: deviceIdInput,
          username: z.string().trim().min(1),
          linuxUid: z.number().int().nonnegative(),
          credentialId: z.string().trim().min(1),
          credential: z.string().trim().min(1),
          durationHours: z.number().int().positive().max(MAX_DURATION_HOURS),
        }),
      )
      .output(enrollmentOutput)
      .mutation(({ ctx, input }) => {
        const created = ctx.enrollments.create({
          deviceId: input.deviceId,
          username: input.username,
          linuxUid: input.linuxUid,
          credentialId: input.credentialId,
          credential: input.credential,
          durationHours: input.durationHours,
        });
        return {
          id: created.id,
          userCode: created.userCode,
          status: created.status,
          userId: created.userId,
          approvedDurationHours: created.approvedDurationHours,
          verificationUri: ctx.enrollmentVerificationUri,
        };
      }),

    /** Tells a waiting device whether the owner approved, and on what terms. */
    enrollmentStatus: deviceProcedure
      .meta({ openapi: { method: 'POST', path: '/api/device-auth/enrollment-status' } })
      .input(z.object({ deviceId: deviceIdInput, enrollmentId: z.string().trim().min(1) }))
      .output(enrollmentOutput)
      .mutation(({ ctx, input }) => {
        const state = ctx.enrollments.poll(input.enrollmentId);
        if (state === null) {
          // An enrollment nobody completed simply expires; the device treats that
          // as a refusal rather than an error it has to interpret.
          return {
            id: input.enrollmentId,
            userCode: '',
            status: 'expired' as const,
            userId: null,
            approvedDurationHours: null,
            verificationUri: ctx.enrollmentVerificationUri,
          };
        }
        return {
          id: state.id,
          userCode: state.userCode,
          status: state.status,
          userId: state.userId,
          approvedDurationHours: state.approvedDurationHours,
          verificationUri: ctx.enrollmentVerificationUri,
        };
      }),
  });
});

export type DeviceAuthApiRouter = typeof deviceAuthApiRouter;
