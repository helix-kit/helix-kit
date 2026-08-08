import { randomUUID } from 'node:crypto';

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { listUserAiUsage, readAiBalance } from './metering';

import type { DatabaseClient } from '../db';

import { aiCreditGrant, aiUsageEvent, aiUserBudget } from '../db/ai-usage-schema';
import { user as userTable } from '../db/auth-schema';
import { createRouterFactory, TRPCError } from '../trpc';

export type AiUsageSessionUser = Readonly<{
  id: string;
  name: string;
  role: string | null;
}>;

export type AiUsageContext = Readonly<{
  db: DatabaseClient;
  user: AiUsageSessionUser | null;
  adminRoles: readonly string[];
}>;

const USAGE_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;
const USER_LIMIT = 200;
const RECENT_EVENTS_DEFAULT = 25;
const RECENT_EVENTS_MAX = 50;
/** Guard-rail on a single top-up so a mistyped amount can't grant a fortune. */
const MAX_GRANT_USD = 10_000;
const MAX_NOTE_LENGTH = 200;
/** Matches the numeric(12,6) money columns. */
const USD_DECIMALS = 6;

const asInt = (column: unknown) => sql<number>`coalesce(sum(${column}), 0)::int`;
const asUsd = (column: unknown) => sql<string>`coalesce(sum(${column}), 0)`;

const toNumber = (value: string | number | null | undefined): number => {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Spend and credit administration is not an agent tool — the agent must not be
// able to inspect or top up its own budget.
const NOT_A_TOOL = { tool: { expose: false } } as const;

/** Platform-wide AI spend and credit administration, across every AI feature. */
export const aiUsageRouter = createRouterFactory<AiUsageContext>()((t) => {
  const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in required' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
    if (!ctx.adminRoles.includes(ctx.user.role ?? '')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sysadmin access required' });
    }
    return next({ ctx });
  });

  const windowStart = () => new Date(Date.now() - USAGE_WINDOW_DAYS * MS_PER_DAY);

  return t.router({
    // The signed-in user's own spend + credit balance, across every AI feature.
    mine: protectedProcedure.meta(NOT_A_TOOL).query(async ({ ctx }) => {
      const scope = eq(aiUsageEvent.userId, ctx.user.id);
      const [balance, [totals], byModel, byFeature, daily, recent] = await Promise.all([
        readAiBalance(ctx.db, ctx.user.id),
        ctx.db
          .select({
            requests: sql<number>`count(*)::int`,
            inputTokens: asInt(aiUsageEvent.inputTokens),
            outputTokens: asInt(aiUsageEvent.outputTokens),
            totalTokens: asInt(aiUsageEvent.totalTokens),
            toolCalls: asInt(aiUsageEvent.toolCalls),
            costUsd: asUsd(aiUsageEvent.costUsd),
          })
          .from(aiUsageEvent)
          .where(scope),
        ctx.db
          .select({
            model: aiUsageEvent.model,
            requests: sql<number>`count(*)::int`,
            totalTokens: asInt(aiUsageEvent.totalTokens),
            costUsd: asUsd(aiUsageEvent.costUsd),
          })
          .from(aiUsageEvent)
          .where(scope)
          .groupBy(aiUsageEvent.model)
          .orderBy(desc(asUsd(aiUsageEvent.costUsd))),
        ctx.db
          .select({
            feature: aiUsageEvent.feature,
            requests: sql<number>`count(*)::int`,
            totalTokens: asInt(aiUsageEvent.totalTokens),
            costUsd: asUsd(aiUsageEvent.costUsd),
          })
          .from(aiUsageEvent)
          .where(scope)
          .groupBy(aiUsageEvent.feature)
          .orderBy(desc(asUsd(aiUsageEvent.costUsd))),
        ctx.db
          .select({
            day: sql<string>`to_char(date_trunc('day', ${aiUsageEvent.createdAt}), 'YYYY-MM-DD')`,
            requests: sql<number>`count(*)::int`,
            totalTokens: asInt(aiUsageEvent.totalTokens),
            costUsd: asUsd(aiUsageEvent.costUsd),
          })
          .from(aiUsageEvent)
          .where(and(scope, gte(aiUsageEvent.createdAt, windowStart())))
          .groupBy(sql`date_trunc('day', ${aiUsageEvent.createdAt})`)
          .orderBy(sql`date_trunc('day', ${aiUsageEvent.createdAt})`),
        listUserAiUsage(ctx.db, ctx.user.id, RECENT_EVENTS_DEFAULT),
      ]);
      return {
        balance,
        totals: {
          requests: totals?.requests ?? 0,
          inputTokens: totals?.inputTokens ?? 0,
          outputTokens: totals?.outputTokens ?? 0,
          totalTokens: totals?.totalTokens ?? 0,
          toolCalls: totals?.toolCalls ?? 0,
          costUsd: toNumber(totals?.costUsd),
        },
        byModel: byModel.map((row) => ({ ...row, costUsd: toNumber(row.costUsd) })),
        byFeature: byFeature.map((row) => ({ ...row, costUsd: toNumber(row.costUsd) })),
        daily: daily.map((row) => ({ ...row, costUsd: toNumber(row.costUsd) })),
        recent,
      };
    }),

    // Platform-wide spend (admin): totals, per-user credit state, per-model, per-feature.
    overview: adminProcedure.meta(NOT_A_TOOL).query(async ({ ctx }) => {
      const [spendRows, grantRows, budgetRows, byModel, byFeature, users] = await Promise.all([
        ctx.db
          .select({
            userId: aiUsageEvent.userId,
            requests: sql<number>`count(*)::int`,
            totalTokens: asInt(aiUsageEvent.totalTokens),
            toolCalls: asInt(aiUsageEvent.toolCalls),
            spentUsd: asUsd(aiUsageEvent.costUsd),
            lastUsedAt: sql<string | null>`max(${aiUsageEvent.createdAt})`,
          })
          .from(aiUsageEvent)
          .groupBy(aiUsageEvent.userId),
        ctx.db
          .select({ userId: aiCreditGrant.userId, grantedUsd: asUsd(aiCreditGrant.amountUsd) })
          .from(aiCreditGrant)
          .groupBy(aiCreditGrant.userId),
        ctx.db
          .select({
            userId: aiUserBudget.userId,
            aiEnabled: aiUserBudget.aiEnabled,
            unlimited: aiUserBudget.unlimited,
          })
          .from(aiUserBudget),
        ctx.db
          .select({
            model: aiUsageEvent.model,
            requests: sql<number>`count(*)::int`,
            totalTokens: asInt(aiUsageEvent.totalTokens),
            costUsd: asUsd(aiUsageEvent.costUsd),
          })
          .from(aiUsageEvent)
          .groupBy(aiUsageEvent.model)
          .orderBy(desc(asUsd(aiUsageEvent.costUsd))),
        ctx.db
          .select({
            feature: aiUsageEvent.feature,
            requests: sql<number>`count(*)::int`,
            totalTokens: asInt(aiUsageEvent.totalTokens),
            costUsd: asUsd(aiUsageEvent.costUsd),
          })
          .from(aiUsageEvent)
          .groupBy(aiUsageEvent.feature)
          .orderBy(desc(asUsd(aiUsageEvent.costUsd))),
        ctx.db
          .select({
            id: userTable.id,
            name: userTable.name,
            email: userTable.email,
            role: userTable.role,
          })
          .from(userTable)
          .orderBy(userTable.name)
          .limit(USER_LIMIT),
      ]);

      const spendByUser = new Map(spendRows.map((row) => [row.userId, row]));
      const grantByUser = new Map(grantRows.map((row) => [row.userId, row]));
      const budgetByUser = new Map(budgetRows.map((row) => [row.userId, row]));

      // Joined in memory rather than SQL: an admin-sized user list is small, and
      // every user must appear (even with no usage) so they can be granted credits.
      const rows = users.map((entry) => {
        const spend = spendByUser.get(entry.id);
        const budget = budgetByUser.get(entry.id);
        const grantedUsd = toNumber(grantByUser.get(entry.id)?.grantedUsd);
        const spentUsd = toNumber(spend?.spentUsd);
        return {
          userId: entry.id,
          name: entry.name,
          email: entry.email,
          role: entry.role,
          // No budget row => never configured => unrestricted.
          aiEnabled: budget?.aiEnabled ?? true,
          unlimited: budget?.unlimited ?? true,
          configured: budget !== undefined,
          grantedUsd,
          spentUsd,
          remainingUsd: grantedUsd - spentUsd,
          requests: spend?.requests ?? 0,
          totalTokens: spend?.totalTokens ?? 0,
          toolCalls: spend?.toolCalls ?? 0,
          lastUsedAt: spend?.lastUsedAt ?? null,
        };
      });

      return {
        totals: {
          spentUsd: rows.reduce((sum, row) => sum + row.spentUsd, 0),
          grantedUsd: rows.reduce((sum, row) => sum + row.grantedUsd, 0),
          requests: rows.reduce((sum, row) => sum + row.requests, 0),
          totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
          activeUsers: rows.filter((row) => row.requests > 0).length,
        },
        rows,
        byModel: byModel.map((row) => ({ ...row, costUsd: toNumber(row.costUsd) })),
        byFeature: byFeature.map((row) => ({ ...row, costUsd: toNumber(row.costUsd) })),
      };
    }),

    // One user's spend detail (admin): balance, recent requests, grant history.
    userDetail: adminProcedure
      .meta(NOT_A_TOOL)
      .input(
        z.object({
          userId: z.string(),
          limit: z.number().int().min(1).max(RECENT_EVENTS_MAX).default(RECENT_EVENTS_DEFAULT),
        }),
      )
      .query(async ({ ctx, input }) => {
        const [balance, events, grants] = await Promise.all([
          readAiBalance(ctx.db, input.userId),
          listUserAiUsage(ctx.db, input.userId, input.limit),
          ctx.db
            .select({
              id: aiCreditGrant.id,
              amountUsd: aiCreditGrant.amountUsd,
              note: aiCreditGrant.note,
              grantedBy: aiCreditGrant.grantedBy,
              createdAt: aiCreditGrant.createdAt,
            })
            .from(aiCreditGrant)
            .where(eq(aiCreditGrant.userId, input.userId))
            .orderBy(desc(aiCreditGrant.createdAt))
            .limit(RECENT_EVENTS_MAX),
        ]);
        return { balance, events, grants };
      }),

    // Turn AI on/off for a user, and whether their spend is capped by credits.
    setAccess: adminProcedure
      .meta(NOT_A_TOOL)
      .input(z.object({ userId: z.string(), aiEnabled: z.boolean(), unlimited: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .insert(aiUserBudget)
          .values({
            userId: input.userId,
            aiEnabled: input.aiEnabled,
            unlimited: input.unlimited,
            updatedBy: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: aiUserBudget.userId,
            set: {
              aiEnabled: input.aiEnabled,
              unlimited: input.unlimited,
              updatedAt: new Date(),
              updatedBy: ctx.user.id,
            },
          });
        return readAiBalance(ctx.db, input.userId);
      }),

    // Top up (positive) or claw back (negative) a user's AI credits.
    grantCredits: adminProcedure
      .meta(NOT_A_TOOL)
      .input(
        z.object({
          userId: z.string(),
          amountUsd: z
            .number()
            .refine((value) => value !== 0, 'Amount must not be zero')
            .refine(
              (value) => Math.abs(value) <= MAX_GRANT_USD,
              `A single adjustment cannot exceed $${MAX_GRANT_USD}`,
            ),
          note: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await ctx.db.insert(aiCreditGrant).values({
          id: randomUUID(),
          userId: input.userId,
          amountUsd: input.amountUsd.toFixed(USD_DECIMALS),
          note: input.note ?? null,
          grantedBy: ctx.user.id,
        });
        // Granting credits to someone who was never configured implies they should
        // now be capped — otherwise the grant would be meaningless.
        await ctx.db
          .insert(aiUserBudget)
          .values({
            userId: input.userId,
            aiEnabled: true,
            unlimited: false,
            updatedBy: ctx.user.id,
          })
          .onConflictDoNothing({ target: aiUserBudget.userId });
        return readAiBalance(ctx.db, input.userId);
      }),
  });
});

export type AiUsageRouter = ReturnType<typeof aiUsageRouter>;
