import { z } from 'zod';

import { AlreadyRevealedError, type EnrollmentRelay } from './enrollment-relay';
import {
  DEVICE_LOGIN_SCOPE,
  type DeviceAuthorizationProvider,
  type UnixIdentityDirectory,
} from './types';

import { createRouterFactory, TRPCError } from '../trpc';

/**
 * The browser half of persistent-credential enrollment.
 *
 * A device has minted a credential and asked the cloud to hand it to its owner.
 * This is where the owner sees what they are approving, approves it, and takes
 * the credential — once.
 */
export type EnrollmentContext = Readonly<{
  user: Readonly<{ id: string }> | null;
  authorization: DeviceAuthorizationProvider;
  directory: UnixIdentityDirectory;
  enrollments: EnrollmentRelay;
}>;

const userCodeInput = z.string().trim().min(1, 'Enter the code shown on the device.');

export const enrollmentRouter = createRouterFactory<EnrollmentContext>()((t) => {
  const signedIn = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  /**
   * Confirms this browser user is the Unix user the device asked for, and may
   * still log in to it. Approving a credential for an account you do not hold
   * would hand a device to somebody else.
   */
  const assertMayApprove = async (
    ctx: EnrollmentContext & { user: { id: string } },
    userCode: string,
  ) => {
    const summary = ctx.enrollments.summary(userCode);
    if (summary?.status !== 'pending') {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'That enrollment has expired or was already handled.',
      });
    }

    const [identity, authorization] = await Promise.all([
      ctx.directory.lookup(ctx.user.id),
      ctx.authorization.authorize(summary.deviceId, ctx.user.id),
    ]);

    if (
      identity?.username !== summary.username ||
      !authorization.allowed ||
      !authorization.scopes.includes(DEVICE_LOGIN_SCOPE)
    ) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You are not authorized to create a credential for that device.',
      });
    }
    return summary;
  };

  return t.router({
    /** What the browser shows before anyone commits to anything. */
    summary: signedIn
      .input(z.object({ userCode: userCodeInput }))
      .output(
        z.object({
          deviceId: z.string(),
          username: z.string(),
          durationHours: z.number().int(),
          status: z.string(),
        }),
      )
      .query(({ ctx, input }) => {
        const summary = ctx.enrollments.summary(input.userCode);
        if (summary === null) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'No such enrollment.' });
        }
        return summary;
      }),

    approve: signedIn
      .input(z.object({ userCode: userCodeInput }))
      .output(z.object({ status: z.string(), durationHours: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const summary = await assertMayApprove(ctx, input.userCode);

        const approved = ctx.enrollments.approve(
          input.userCode,
          ctx.user.id,
          summary.durationHours,
        );
        if (approved === null) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'That enrollment is no longer open.' });
        }
        return { status: approved.status, durationHours: summary.durationHours };
      }),

    deny: signedIn
      .input(z.object({ userCode: userCodeInput }))
      .output(z.object({ denied: z.boolean() }))
      .mutation(({ ctx, input }) => ({ denied: ctx.enrollments.deny(input.userCode) })),

    /**
     * Hands the credential over, once. The cloud's copy is destroyed in the same
     * step, so there is deliberately no way to ask again.
     */
    reveal: signedIn
      .input(z.object({ userCode: userCodeInput }))
      .output(z.object({ credential: z.string() }))
      .mutation(({ ctx, input }) => {
        try {
          return { credential: ctx.enrollments.reveal(input.userCode, ctx.user.id) };
        } catch (error) {
          if (error instanceof AlreadyRevealedError) {
            throw new TRPCError({ code: 'CONFLICT', message: error.message });
          }
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'That credential is not available to you.',
          });
        }
      }),
  });
});

export type EnrollmentRouter = typeof enrollmentRouter;
