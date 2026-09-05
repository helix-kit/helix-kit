import { z } from 'zod';

import { offlineResponse } from './offline-code';
import {
  DEVICE_LOGIN_SCOPE,
  type DeviceAuthorizationProvider,
  type DeviceSecretStore,
  type UnixIdentityDirectory,
} from './types';

import { createRouterFactory, TRPCError } from '../trpc';

/**
 * The browser half of offline device authentication.
 *
 * Someone standing at a device that cannot reach the cloud reads a challenge off
 * its screen and submits it here, from a phone that can. What comes back is a
 * response only that device will accept, for only that person.
 *
 * The request carries a device id and a challenge and nothing else. It never says
 * who the user is: that comes from the session, so submitting somebody else's
 * challenge gets you a response bound to *you*, which their device will refuse.
 */
export type OfflineAuthContext = Readonly<{
  user: Readonly<{ id: string }> | null;
  authorization: DeviceAuthorizationProvider;
  directory: UnixIdentityDirectory;
  secrets: DeviceSecretStore;
}>;

export const offlineAuthRouter = createRouterFactory<OfflineAuthContext>()((t) => {
  const signedIn = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  return t.router({
    respond: signedIn
      .input(
        z.object({
          deviceId: z.string().trim().min(1, 'Enter the device id shown on the device.'),
          challenge: z.string().trim().min(1, 'Enter the challenge shown on the device.'),
        }),
      )
      .output(z.object({ response: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const [identity, authorization, secret] = await Promise.all([
          ctx.directory.lookup(ctx.user.id),
          ctx.authorization.authorize(input.deviceId, ctx.user.id),
          ctx.secrets.secretFor(input.deviceId),
        ]);

        // Authorization is checked before anything is computed: a user who may not
        // log in never receives a response at all, rather than one that is quietly
        // useless. The same refusal covers every reason, so this cannot be used to
        // probe which devices exist or who has access to them.
        if (
          identity === null ||
          secret === null ||
          !authorization.allowed ||
          !authorization.scopes.includes(DEVICE_LOGIN_SCOPE)
        ) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You are not authorized to sign in to that device.',
          });
        }

        let response: string;
        try {
          response = offlineResponse(secret, {
            deviceId: input.deviceId,
            userId: ctx.user.id,
            linuxUid: identity.linuxUid,
            challenge: input.challenge,
          });
        } catch {
          // A challenge that will not parse is a typo, not a server fault.
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'That challenge does not look right. Check it against the device.',
          });
        }

        return { response };
      }),
  });
});

export type OfflineAuthRouter = typeof offlineAuthRouter;
