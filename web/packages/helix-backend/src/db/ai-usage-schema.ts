import { boolean, index, integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { user } from './auth-schema';

/**
 * Platform-wide AI metering. These tables are deliberately NOT agent-specific:
 * every AI feature (the site assistant, PDF reports, anything added later) records
 * into the same ledger, tagged by `feature`, and every user's credits are shared
 * across all of them.
 *
 * Cost is computed by us, not reported by the provider: the AI Gateway's own cost
 * endpoints are account-level (they know the Vercel account, not our users), so a
 * request's cost is tokens x the gateway's per-model pricing.
 */

/** Money columns: USD with enough precision for sub-cent per-request costs. */
const USD_PRECISION = { precision: 12, scale: 6 } as const;

/** One AI request, attributed to the user who caused it and the feature that ran it. */
export const aiUsageEvent = pgTable(
  'ai_usage_event',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Which AI surface produced this: 'assistant', 'pdf-report', … */
    feature: text('feature').notNull(),
    /** Gateway model id, e.g. `deepseek/deepseek-v4-pro`. */
    model: text('model').notNull(),
    /**
     * Free-form reference to whatever the feature considers the subject of the
     * request (a conversation id, a report id, …). Soft — no FK — so usage history
     * outlives the thing it refers to.
     */
    referenceId: text('reference_id'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', USD_PRECISION).notNull().default('0'),
    /** Set when pricing for the model was unknown, so cost is a floor not a fact. */
    costEstimated: boolean('cost_estimated').notNull().default(false),
    toolCalls: integer('tool_calls').notNull().default(0),
    steps: integer('steps').notNull().default(1),
    durationMs: integer('duration_ms'),
    finishReason: text('finish_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('ai_usage_event_user_created_idx').on(table.userId, table.createdAt),
    index('ai_usage_event_created_idx').on(table.createdAt),
    index('ai_usage_event_feature_idx').on(table.feature, table.createdAt),
  ],
);

/**
 * A user's AI access settings, across every feature. NO ROW MEANS UNRESTRICTED —
 * existing users keep working until an admin deliberately limits them.
 */
export const aiUserBudget = pgTable('ai_user_budget', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** Hard switch: false blocks every AI feature for this user. */
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  /** When true the granted balance is ignored and spend is uncapped. */
  unlimited: boolean('unlimited').notNull().default(false),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  /** Plain text, no FK: deleting an admin must not erase the audit trail. */
  updatedBy: text('updated_by'),
});

/**
 * A credit top-up, spendable on any AI feature. Credits do not reset — the balance
 * is `sum(grants) - sum(usage cost)` — so keeping grants as rows gives an audit
 * trail of who granted what instead of a mutable counter.
 */
export const aiCreditGrant = pgTable(
  'ai_credit_grant',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Positive to grant, negative to claw back. */
    amountUsd: numeric('amount_usd', USD_PRECISION).notNull(),
    note: text('note'),
    grantedBy: text('granted_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('ai_credit_grant_user_idx').on(table.userId, table.createdAt)],
);

export type AiUsageEvent = typeof aiUsageEvent.$inferSelect;
export type NewAiUsageEvent = typeof aiUsageEvent.$inferInsert;
export type AiUserBudget = typeof aiUserBudget.$inferSelect;
export type AiCreditGrant = typeof aiCreditGrant.$inferSelect;
