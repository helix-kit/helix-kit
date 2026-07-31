import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Load-test measurement hook, NOT part of the product schema: no migration, provisioned at runtime by the load-test harness (CREATE TABLE IF NOT EXISTS).
export const workflowRunResult = pgTable(
  'workflow_run_result',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    deviceId: text('device_id').notNull(),
    messageId: text('message_id').notNull(),
    // Nanosecond wall clock from the load generator; text to avoid JS bigint loss.
    emittedAtNs: text('emitted_at_ns'),
    // 'completed' — ran the full graph; 'skipped' — the if/else gate rejected it.
    status: text('status').notNull(),
    // 'inngest' — routed through the durable engine; 'direct' — inline baseline.
    mode: text('mode').notNull(),
    completedAt: timestamp('completed_at').defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index('workflow_run_result_run_id_idx').on(table.runId),
  }),
);
