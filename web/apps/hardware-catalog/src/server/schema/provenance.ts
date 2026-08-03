import { index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

import {
  actorKindEnum,
  claimStatusEnum,
  confidenceEnum,
  proposalStatusEnum,
  researchTaskStatusEnum,
  sourceTypeEnum,
  timestamps,
} from './_shared';

/**
 * Provenance is structural here, not decorative: agents are first-class writers, so every
 * non-obvious value must be traceable to where it came from, and conflicting values are kept
 * rather than overwritten (research doc §9, finding 13).
 *
 * This module imports nothing from the entity modules — `claim` addresses rows generically by
 * (table, id, field) — which is what lets every other schema file depend on it.
 */

/** A document a value was read out of. */
export const source = pgTable(
  'source',
  {
    id: text('id').primaryKey(),
    url: text('url').notNull(),
    /** Redirect-resolved, query-stripped URL, so the same page added twice dedupes. */
    canonicalUrl: text('canonical_url').notNull(),
    type: sourceTypeEnum('type').notNull(),
    title: text('title').notNull().default(''),
    publisher: text('publisher').notNull().default(''),
    publishedAt: timestamp('published_at'),
    retrievedAt: timestamp('retrieved_at').defaultNow().notNull(),
    /** Hash of the retrieved body, so a silent edit upstream is detectable. */
    contentHash: text('content_hash'),
    archiveUrl: text('archive_url'),
    /** Lower is more trustworthy; derived from `type` but overridable per source. */
    trustRank: integer('trust_rank').notNull().default(100),
    notes: text('notes').notNull().default(''),
    ...timestamps,
  },
  (table) => [
    unique('source_canonical_url_unique').on(table.canonicalUrl),
    index('source_type_idx').on(table.type),
  ],
);

/**
 * One asserted value for one field of one row, with its evidence. Canonical tables hold the
 * currently-accepted value for fast querying; this table holds *why*, plus every competing
 * assertion that was not chosen.
 */
export const claim = pgTable(
  'claim',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').references(() => source.id, { onDelete: 'set null' }),
    /** Target row, addressed generically so this table never depends on the entity modules. */
    entityTable: text('entity_table').notNull(),
    entityId: text('entity_id').notNull(),
    /** Dotted path within the row, e.g. `maxCapacityMb`. Empty means the row as a whole. */
    fieldPath: text('field_path').notNull().default(''),
    valueText: text('value_text'),
    valueJson: jsonb('value_json'),
    confidence: confidenceEnum('confidence').notNull().default('medium'),
    status: claimStatusEnum('status').notNull().default('proposed'),
    assertedByKind: actorKindEnum('asserted_by_kind').notNull().default('human'),
    assertedById: text('asserted_by_id'),
    /** Verbatim fragment supporting the value — the anti-hallucination anchor for agents. */
    quotedText: text('quoted_text').notNull().default(''),
    pageOrSection: text('page_or_section').notNull().default(''),
    supersededById: text('superseded_by_id'),
    notes: text('notes').notNull().default(''),
    ...timestamps,
  },
  (table) => [
    index('claim_entity_idx').on(table.entityTable, table.entityId),
    index('claim_field_idx').on(table.entityTable, table.entityId, table.fieldPath),
    index('claim_status_idx').on(table.status),
    index('claim_source_idx').on(table.sourceId),
  ],
);

/**
 * A batch of writes an agent or human proposes. Canonical rows change only by applying one of
 * these, which gives every mutation an author, an evidence set, and a reversible diff.
 */
export const changeProposal = pgTable(
  'change_proposal',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    status: proposalStatusEnum('status').notNull().default('draft'),
    authorKind: actorKindEnum('author_kind').notNull().default('human'),
    authorId: text('author_id'),
    /** Groups the proposals produced by one agent run, so a bad run can be reverted wholesale. */
    agentRunId: text('agent_run_id'),
    researchTaskId: text('research_task_id'),
    /** Ordered list of `{ op, table, id, values }` operations. */
    patch: jsonb('patch').notNull(),
    sourceIds: text('source_ids').array().notNull().default([]),
    validationResult: jsonb('validation_result'),
    reviewedById: text('reviewed_by_id'),
    reviewedAt: timestamp('reviewed_at'),
    reviewNotes: text('review_notes').notNull().default(''),
    appliedAt: timestamp('applied_at'),
    /** Two agents discovering the same board must not create two proposals. */
    idempotencyKey: text('idempotency_key'),
    ...timestamps,
  },
  (table) => [
    unique('change_proposal_idempotency_key_unique').on(table.idempotencyKey),
    index('change_proposal_status_idx').on(table.status),
    index('change_proposal_agent_run_idx').on(table.agentRunId),
  ],
);

/** A unit of research handed to an agent: "find the missing idle-power figure for X". */
export const researchTask = pgTable(
  'research_task',
  {
    id: text('id').primaryKey(),
    subject: text('subject').notNull(),
    /** Optional target row when the task is "fill in this record" rather than "find new ones". */
    entityTable: text('entity_table'),
    entityId: text('entity_id'),
    instructions: text('instructions').notNull().default(''),
    status: researchTaskStatusEnum('status').notNull().default('open'),
    assignedTo: text('assigned_to'),
    priority: integer('priority').notNull().default(0),
    result: jsonb('result'),
    failureReason: text('failure_reason').notNull().default(''),
    completedAt: timestamp('completed_at'),
    ...timestamps,
  },
  (table) => [
    index('research_task_status_idx').on(table.status),
    index('research_task_entity_idx').on(table.entityTable, table.entityId),
  ],
);

/**
 * Provenance columns spread into every fact table. `sourceId` is the primary citation for the
 * row; richer or conflicting evidence lives in `claim`.
 */
export const provenance = {
  sourceId: text('source_id').references(() => source.id, { onDelete: 'set null' }),
  confidence: confidenceEnum('confidence').notNull().default('medium'),
  verifiedAt: timestamp('verified_at'),
};

export type Source = typeof source.$inferSelect;
export type NewSource = typeof source.$inferInsert;
export type Claim = typeof claim.$inferSelect;
export type NewClaim = typeof claim.$inferInsert;
export type ChangeProposal = typeof changeProposal.$inferSelect;
export type NewChangeProposal = typeof changeProposal.$inferInsert;
export type ResearchTask = typeof researchTask.$inferSelect;
export type NewResearchTask = typeof researchTask.$inferInsert;
