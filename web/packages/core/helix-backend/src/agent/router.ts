import { randomUUID } from 'node:crypto';

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseClient } from '../db';

import {
  agentConversation,
  agentToolCall,
  agentUsage,
  type NewAgentToolCall,
  type NewAgentUsage,
} from '../db/agent-schema';
import { user as userTable } from '../db/auth-schema';
import { createRouterFactory, TRPCError } from '../trpc';

export type AgentSessionUser = Readonly<{
  id: string;
  name: string;
  role: string | null;
}>;

export type AgentContext = Readonly<{
  db: DatabaseClient;
  user: AgentSessionUser | null;
  adminRoles: readonly string[];
}>;

const TITLE_MAX_LENGTH = 200;
const LIST_LIMIT = 100;
const USAGE_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;
const USAGE_USER_LIMIT = 200;

const asInt = (column: unknown) => sql<number>`coalesce(sum(${column}), 0)::int`;

// The conversation-management API is not itself an agent tool — the agent
// shouldn't manage its own chat threads. Kept off the tool surface.
const NOT_A_TOOL = { tool: { expose: false } } as const;

/** Session-gated conversation store for the site AI agent. */
export const agentRouter = createRouterFactory<AgentContext>()((t) => {
  const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to use the assistant' });
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
    // The signed-in user's own AI usage: lifetime totals, by-model, and a daily series.
    myUsage: protectedProcedure.meta(NOT_A_TOOL).query(async ({ ctx }) => {
      const scope = eq(agentUsage.userId, ctx.user.id);
      const [totals] = await ctx.db
        .select({
          requests: sql<number>`count(*)::int`,
          inputTokens: asInt(agentUsage.inputTokens),
          outputTokens: asInt(agentUsage.outputTokens),
          totalTokens: asInt(agentUsage.totalTokens),
          toolCalls: asInt(agentUsage.toolCalls),
        })
        .from(agentUsage)
        .where(scope);
      const byModel = await ctx.db
        .select({
          model: agentUsage.model,
          requests: sql<number>`count(*)::int`,
          totalTokens: asInt(agentUsage.totalTokens),
        })
        .from(agentUsage)
        .where(scope)
        .groupBy(agentUsage.model)
        .orderBy(desc(asInt(agentUsage.totalTokens)));
      const daily = await ctx.db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${agentUsage.createdAt}), 'YYYY-MM-DD')`,
          requests: sql<number>`count(*)::int`,
          totalTokens: asInt(agentUsage.totalTokens),
        })
        .from(agentUsage)
        .where(and(scope, gte(agentUsage.createdAt, windowStart())))
        .groupBy(sql`date_trunc('day', ${agentUsage.createdAt})`)
        .orderBy(sql`date_trunc('day', ${agentUsage.createdAt})`);
      return {
        totals: totals ?? {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          toolCalls: 0,
        },
        byModel,
        daily,
      };
    }),

    // Platform-wide AI usage (admin): totals, per-user breakdown, by-model.
    usageOverview: adminProcedure.meta(NOT_A_TOOL).query(async ({ ctx }) => {
      const [totals] = await ctx.db
        .select({
          requests: sql<number>`count(*)::int`,
          totalTokens: asInt(agentUsage.totalTokens),
          toolCalls: asInt(agentUsage.toolCalls),
          activeUsers: sql<number>`count(distinct ${agentUsage.userId})::int`,
        })
        .from(agentUsage);
      const byUser = await ctx.db
        .select({
          userId: agentUsage.userId,
          name: userTable.name,
          email: userTable.email,
          requests: sql<number>`count(*)::int`,
          totalTokens: asInt(agentUsage.totalTokens),
          toolCalls: asInt(agentUsage.toolCalls),
          lastUsedAt: sql<string>`max(${agentUsage.createdAt})`,
        })
        .from(agentUsage)
        .innerJoin(userTable, eq(agentUsage.userId, userTable.id))
        .groupBy(agentUsage.userId, userTable.name, userTable.email)
        .orderBy(desc(asInt(agentUsage.totalTokens)))
        .limit(USAGE_USER_LIMIT);
      const byModel = await ctx.db
        .select({
          model: agentUsage.model,
          requests: sql<number>`count(*)::int`,
          totalTokens: asInt(agentUsage.totalTokens),
        })
        .from(agentUsage)
        .groupBy(agentUsage.model)
        .orderBy(desc(asInt(agentUsage.totalTokens)));
      return {
        totals: totals ?? { requests: 0, totalTokens: 0, toolCalls: 0, activeUsers: 0 },
        byUser,
        byModel,
      };
    }),

    listConversations: protectedProcedure.meta(NOT_A_TOOL).query(async ({ ctx }) =>
      ctx.db
        .select({
          id: agentConversation.id,
          title: agentConversation.title,
          createdAt: agentConversation.createdAt,
          updatedAt: agentConversation.updatedAt,
        })
        .from(agentConversation)
        .where(eq(agentConversation.userId, ctx.user.id))
        .orderBy(desc(agentConversation.updatedAt))
        .limit(LIST_LIMIT),
    ),

    getConversation: protectedProcedure
      .meta(NOT_A_TOOL)
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const [conversation] = await ctx.db
          .select()
          .from(agentConversation)
          .where(and(eq(agentConversation.id, input.id), eq(agentConversation.userId, ctx.user.id)))
          .limit(1);
        if (conversation === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
        }
        return conversation;
      }),

    createConversation: protectedProcedure
      .meta(NOT_A_TOOL)
      .input(z.object({ title: z.string().max(TITLE_MAX_LENGTH).optional() }))
      .mutation(async ({ ctx, input }) => {
        const [conversation] = await ctx.db
          .insert(agentConversation)
          .values({ id: randomUUID(), userId: ctx.user.id, title: input.title ?? '', messages: [] })
          .returning();
        return conversation;
      }),

    renameConversation: protectedProcedure
      .meta(NOT_A_TOOL)
      .input(z.object({ id: z.string(), title: z.string().max(TITLE_MAX_LENGTH) }))
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.db
          .update(agentConversation)
          .set({ title: input.title })
          .where(and(eq(agentConversation.id, input.id), eq(agentConversation.userId, ctx.user.id)))
          .returning({ id: agentConversation.id });
        if (updated.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
        }
        return { id: input.id };
      }),

    deleteConversation: protectedProcedure
      .meta(NOT_A_TOOL)
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(agentConversation)
          .where(
            and(eq(agentConversation.id, input.id), eq(agentConversation.userId, ctx.user.id)),
          );
        return { id: input.id };
      }),
  });
});

export type AgentRouter = ReturnType<typeof agentRouter>;

/**
 * Overwrite a conversation's whole message list (the AI SDK `UIMessage[]`) and an
 * optional title. Called from the chat route's `onFinish` with the full turn.
 * `updatedAt` bumps automatically via the schema's `$onUpdate`.
 */
export const saveConversation = async (
  db: DatabaseClient,
  conversationId: string,
  messages: unknown[],
  title?: string,
): Promise<void> => {
  await db
    .update(agentConversation)
    .set(title === undefined ? { messages } : { messages, title })
    .where(eq(agentConversation.id, conversationId));
};

/**
 * Look up the minimal session-user shape for a user id — used by the MCP server to
 * build a request context after authenticating via OAuth token or API key.
 */
export const findAgentUser = async (
  db: DatabaseClient,
  userId: string,
): Promise<AgentSessionUser | null> => {
  const [row] = await db
    .select({ id: userTable.id, name: userTable.name, role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row === undefined ? null : { id: row.id, name: row.name, role: row.role ?? null };
};

/** Append one tool-call audit row. */
export const recordToolCall = async (
  db: DatabaseClient,
  entry: Omit<NewAgentToolCall, 'id'>,
): Promise<void> => {
  await db.insert(agentToolCall).values({ id: randomUUID(), ...entry });
};

/** Record one chat turn's AI usage metrics (tokens, tool calls, model, timing). */
export const recordUsage = async (
  db: DatabaseClient,
  entry: Omit<NewAgentUsage, 'id'>,
): Promise<void> => {
  await db.insert(agentUsage).values({ id: randomUUID(), ...entry });
};
