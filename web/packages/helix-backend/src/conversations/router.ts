import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseClient } from '../db';

import {
  conversation,
  conversationToolCall,
  type NewConversationToolCall,
} from '../db/conversation-schema';
import { createRouterFactory, TRPCError } from '../trpc';

export type ConversationSessionUser = Readonly<{ id: string }>;

export type ConversationContext = Readonly<{
  db: DatabaseClient;
  user: ConversationSessionUser | null;
}>;

const TITLE_MAX_LENGTH = 200;
const LIST_LIMIT = 100;

// Managing threads is not something the assistant should do to itself, so these
// stay off the tool surface even though they sit on the same tRPC tree.
const NOT_A_TOOL = { tool: { expose: false } } as const;

export type ConversationsRouterOptions = Readonly<{
  /**
   * Which feature these threads belong to.
   *
   * Bound here rather than taken as input: a surface sent by the client would
   * let one feature list and delete another's threads, and there is no reason a
   * caller should be able to name it.
   */
  surface: string;
}>;

/**
 * A user's chat threads for one surface: list them, open one, start another.
 *
 * Mounted once per surface rather than written once per surface. Every feature
 * that grows a chat needs exactly this, and the assistant already proved the
 * shape — the only thing that differs between them is which threads they can
 * see, which is what `surface` and `subjectId` settle.
 */
export const conversationsRouter = (options: ConversationsRouterOptions) =>
  createRouterFactory<ConversationContext>()((t) => {
    const protectedProcedure = t.procedure.use(({ ctx, next }) => {
      if (ctx.user === null) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to use this' });
      }
      return next({ ctx: { ...ctx, user: ctx.user } });
    });

    /** Mine, on this surface, about this subject — the only scope anything runs in. */
    const owned = (userId: string, subjectId?: string | null) =>
      and(
        eq(conversation.userId, userId),
        eq(conversation.surface, options.surface),
        subjectId === undefined || subjectId === null
          ? isNull(conversation.subjectId)
          : eq(conversation.subjectId, subjectId),
      );

    return t.router({
      list: protectedProcedure
        .meta(NOT_A_TOOL)
        .input(z.object({ subjectId: z.string().nullish() }).default({}))
        .query(async ({ ctx, input }) =>
          ctx.db
            .select({
              id: conversation.id,
              title: conversation.title,
              createdAt: conversation.createdAt,
              updatedAt: conversation.updatedAt,
            })
            .from(conversation)
            .where(owned(ctx.user.id, input.subjectId))
            .orderBy(desc(conversation.updatedAt))
            .limit(LIST_LIMIT),
        ),

      get: protectedProcedure
        .meta(NOT_A_TOOL)
        .input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => {
          const [row] = await ctx.db
            .select()
            .from(conversation)
            .where(
              and(
                eq(conversation.id, input.id),
                eq(conversation.userId, ctx.user.id),
                eq(conversation.surface, options.surface),
              ),
            )
            .limit(1);
          if (row === undefined) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
          }
          return row;
        }),

      create: protectedProcedure
        .meta(NOT_A_TOOL)
        .input(
          z
            .object({
              subjectId: z.string().nullish(),
              title: z.string().max(TITLE_MAX_LENGTH).optional(),
            })
            .default({}),
        )
        .mutation(async ({ ctx, input }) => {
          const [row] = await ctx.db
            .insert(conversation)
            .values({
              id: randomUUID(),
              userId: ctx.user.id,
              surface: options.surface,
              subjectId: input.subjectId ?? null,
              title: input.title ?? '',
              messages: [],
            })
            .returning();
          return row;
        }),

      rename: protectedProcedure
        .meta(NOT_A_TOOL)
        .input(z.object({ id: z.string(), title: z.string().max(TITLE_MAX_LENGTH) }))
        .mutation(async ({ ctx, input }) => {
          const updated = await ctx.db
            .update(conversation)
            .set({ title: input.title })
            .where(
              and(
                eq(conversation.id, input.id),
                eq(conversation.userId, ctx.user.id),
                eq(conversation.surface, options.surface),
              ),
            )
            .returning({ id: conversation.id });
          if (updated.length === 0) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
          }
          return { id: input.id };
        }),

      remove: protectedProcedure
        .meta(NOT_A_TOOL)
        .input(z.object({ id: z.string() }))
        .mutation(async ({ ctx, input }) => {
          await ctx.db
            .delete(conversation)
            .where(
              and(
                eq(conversation.id, input.id),
                eq(conversation.userId, ctx.user.id),
                eq(conversation.surface, options.surface),
              ),
            );
          return { id: input.id };
        }),
    });
  });

export type ConversationsRouter = ReturnType<ReturnType<typeof conversationsRouter>>;

/**
 * Overwrites a thread's messages, and its title if one is given.
 *
 * Called from a chat route's `onFinish` with the whole turn; `updatedAt` bumps
 * itself. Not scoped to a surface: the caller already holds an id it was given.
 */
export const saveConversation = async (
  db: DatabaseClient,
  conversationId: string,
  messages: unknown[],
  title?: string,
): Promise<void> => {
  await db
    .update(conversation)
    .set(title === undefined ? { messages } : { messages, title })
    .where(eq(conversation.id, conversationId));
};

/** Appends one tool-call audit row. */
export const recordToolCall = async (
  db: DatabaseClient,
  entry: Omit<NewConversationToolCall, 'id'>,
): Promise<void> => {
  await db.insert(conversationToolCall).values({ id: randomUUID(), ...entry });
};
