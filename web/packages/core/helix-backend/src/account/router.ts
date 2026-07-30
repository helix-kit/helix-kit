import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseClient } from '../db';

import { oauthAccessToken, oauthApplication, oauthConsent } from '../db/auth-schema';
import { createRouterFactory, TRPCError } from '../trpc';

type AccountSessionUser = Readonly<{
  id: string;
  name: string;
  role: string | null;
}>;

export type AccountContext = Readonly<{
  db: DatabaseClient;
  user: AccountSessionUser | null;
}>;

// These are user-facing account operations, never agent tools.
const NOT_A_TOOL = { tool: { expose: false } } as const;

/** Session-gated account management: the OAuth apps a user has connected (MCP clients). */
export const accountRouter = createRouterFactory<AccountContext>()((t) => {
  const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in required' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  return t.router({
    // OAuth applications the user has authorized (e.g. an MCP client via the OAuth flow).
    listConnectedApps: protectedProcedure.meta(NOT_A_TOOL).query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          clientId: oauthApplication.clientId,
          name: oauthApplication.name,
          icon: oauthApplication.icon,
          scopes: oauthConsent.scopes,
          authorizedAt: oauthConsent.createdAt,
        })
        .from(oauthConsent)
        .innerJoin(oauthApplication, eq(oauthConsent.clientId, oauthApplication.clientId))
        .where(eq(oauthConsent.userId, ctx.user.id))
        .orderBy(desc(oauthConsent.createdAt));
      return rows.map((row) => ({
        ...row,
        scopes: row.scopes.split(' ').filter((scope) => scope !== ''),
      }));
    }),

    // Revoke an app: drop its access/refresh tokens and the consent for this user.
    revokeConnectedApp: protectedProcedure
      .meta(NOT_A_TOOL)
      .input(z.object({ clientId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(oauthAccessToken)
          .where(
            and(
              eq(oauthAccessToken.clientId, input.clientId),
              eq(oauthAccessToken.userId, ctx.user.id),
            ),
          );
        await ctx.db
          .delete(oauthConsent)
          .where(
            and(eq(oauthConsent.clientId, input.clientId), eq(oauthConsent.userId, ctx.user.id)),
          );
        return { clientId: input.clientId };
      }),
  });
});

export type AccountRouter = ReturnType<typeof accountRouter>;
