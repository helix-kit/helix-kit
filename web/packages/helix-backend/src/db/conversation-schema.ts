import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { user } from './auth-schema';

/**
 * One chat thread, owned by one user, belonging to one surface.
 *
 * The whole conversation is a single row: `messages` holds the AI SDK
 * `UIMessage[]` verbatim, overwritten atomically each turn. That matches how
 * `useChat` sends and receives the full array, and keeps a thread's history in
 * one lossless place rather than reassembled from per-message rows.
 *
 * `surface` says which feature the thread belongs to and `subjectId` what it is
 * about — a report template, a device, nothing at all for the site assistant.
 * Both are here because every surface that grows a chat needs the same three
 * things (list mine, open one, start another), and the alternative is a fourth
 * near-identical table the next time.
 */
export const conversation = pgTable(
  'conversation',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Which feature the thread belongs to — `assistant`, `pdf-report`, … */
    surface: text('surface').notNull(),
    /** What the thread is about, when the surface has subjects. */
    subjectId: text('subject_id'),
    title: text('title').notNull().default(''),
    messages: jsonb('messages').$type<unknown[]>().notNull().default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    archivedAt: timestamp('archived_at'),
  },
  (table) => [
    // The only listing that exists: this user's threads for this surface and
    // subject, newest first.
    index('conversation_owner_idx').on(
      table.userId,
      table.surface,
      table.subjectId,
      table.updatedAt,
    ),
  ],
);

/**
 * Audit trail of every tool a conversation executed on a user's behalf.
 *
 * The assistant exposes the whole tRPC surface as tools, destructive mutations
 * included, so every side-effecting call is recorded with its input, result and
 * timing. `messageId` is a soft reference to the message that triggered it.
 */
export const conversationToolCall = pgTable(
  'conversation_tool_call',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
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
    index('conversation_tool_call_conversation_idx').on(table.conversationId, table.createdAt),
    index('conversation_tool_call_user_idx').on(table.userId, table.createdAt),
  ],
);

export type Conversation = typeof conversation.$inferSelect;
export type NewConversation = typeof conversation.$inferInsert;
export type ConversationToolCall = typeof conversationToolCall.$inferSelect;
export type NewConversationToolCall = typeof conversationToolCall.$inferInsert;
