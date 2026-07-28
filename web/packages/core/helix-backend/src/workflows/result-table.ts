import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Terminal record written by the workflow's final (notification) node. This is a
// load-test measurement hook, NOT part of the product database schema: it is not
// registered in the drizzle schema and has no migration. The workflow load-test
// harness provisions the table at runtime (CREATE TABLE IF NOT EXISTS) so runs
// can be timed and counted; day-to-day the workflow feature never writes it.
//
// One row per completed workflow run. `emittedAtNs` mirrors device_event's
// publishedAtNs convention (stored as text, cast to numeric in the latency
// query) so the end of the pipeline can be timed against when the device emitted
// the event.
export const workflowRunResult = pgTable(
  'workflow_run_result',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    deviceId: text('device_id').notNull(),
    messageId: text('message_id').notNull(),
    // Nanosecond wall clock captured by the load generator when it published the
    // triggering event (payload.publishedAtNs); text to avoid JS bigint loss.
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
