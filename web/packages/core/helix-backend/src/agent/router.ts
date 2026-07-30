import { randomUUID } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseClient } from '../db';

import { agentConversation, agentToolCall, type NewAgentToolCall } from '../db/agent-schema';
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
}>;

const TITLE_MAX_LENGTH = 200;
const LIST_LIMIT = 100;

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

  return t.router({
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
