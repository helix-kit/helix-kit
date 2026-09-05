import { z } from 'zod';

import { type DeviceAuthorizationProvider, type UnixIdentityDirectory } from './types';

import type { DatabaseClient } from '../db';

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
}>;

const deviceIdInput = z.string().trim().min(1, 'deviceId is required');
const userIdInput = z.string().trim().min(1, 'userId is required');

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
    authorizeLogin: deviceProcedure
      .meta({ openapi: { method: 'POST', path: '/api/device-auth/authorize' } })
      .input(z.object({ deviceId: deviceIdInput, userId: userIdInput }))
      .output(
        z.object({
          allowed: z.boolean(),
          linuxUid: z.number().int().nullable(),
          policyVersion: z.number().int(),
          scopes: z.array(z.string()),
          username: z.string().nullable(),
          userId: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [identity, authorization] = await Promise.all([
          ctx.directory.lookup(input.userId),
          ctx.authorization.authorize(input.deviceId, input.userId),
        ]);

        // A user with no Unix identity cannot be logged in as anybody, whatever
        // their scopes say.
        const allowed = authorization.allowed && identity !== null;

        return {
          allowed,
          linuxUid: identity?.linuxUid ?? null,
          policyVersion: authorization.policyVersion,
          scopes: [...authorization.scopes],
          username: identity?.username ?? null,
          userId: input.userId,
        };
      }),
  });
});

export type DeviceAuthApiRouter = typeof deviceAuthApiRouter;
