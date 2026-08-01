import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { user } from './auth-schema';

/**
 * One AI-agent chat thread, owned by one user. The whole conversation is stored
 * as a single row: `messages` holds the AI SDK v5 `UIMessage[]` (text, tool calls,
 * tool results) verbatim, overwritten atomically each turn from the chat route's
 * `onFinish`. This matches how `useChat` sends/receives the full message array and
 * keeps a thread's history in one lossless place (no per-message rows).
 */
export const agentConversation = pgTable(
  'agent_conversation',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    messages: jsonb('messages').$type<unknown[]>().notNull().default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    archivedAt: timestamp('archived_at'),
  },
  (table) => [index('agent_conversation_user_idx').on(table.userId, table.updatedAt)],
);

/**
 * Audit trail of every tool the agent executed on a user's behalf. Because the
 * whole tRPC surface is exposed as tools — including destructive mutations — every
 * side-effecting call is recorded here with its input, result (or error), and
 * timing. `messageId` is a soft reference to the AI SDK message that triggered it.
 */
export const agentToolCall = pgTable(
  'agent_tool_call',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => agentConversation.id, { onDelete: 'cascade' }),
    messageId: text('message_id'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    toolPath: text('tool_path').notNull(),
    input: jsonb('input'),
    output: jsonb('output'),
    error: text('error'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('agent_tool_call_conversation_idx').on(table.conversationId, table.createdAt),
    index('agent_tool_call_user_idx').on(table.userId, table.createdAt),
  ],
);

/**
 * Per-turn AI usage — a first-class usage metric (tokens, tool calls, model). One
 * row per completed chat turn, written from the chat route's `streamText.onFinish`.
 * `conversationId` is a soft reference (no FK) so usage history survives conversation
 * deletion; a user's usage is removed only when the user is deleted.
 */
export const agentUsage = pgTable(
  'agent_usage',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id'),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    toolCalls: integer('tool_calls').notNull().default(0),
    steps: integer('steps').notNull().default(1),
    durationMs: integer('duration_ms'),
    finishReason: text('finish_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('agent_usage_user_idx').on(table.userId, table.createdAt),
    index('agent_usage_created_idx').on(table.createdAt),
  ],
);

export type AgentConversation = typeof agentConversation.$inferSelect;
export type NewAgentConversation = typeof agentConversation.$inferInsert;
export type AgentToolCall = typeof agentToolCall.$inferSelect;
export type NewAgentToolCall = typeof agentToolCall.$inferInsert;
export type AgentUsage = typeof agentUsage.$inferSelect;
export type NewAgentUsage = typeof agentUsage.$inferInsert;
