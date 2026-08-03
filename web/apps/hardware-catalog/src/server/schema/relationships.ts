import { boolean, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

import {
  compatibilityLevelEnum,
  lifecycleStateEnum,
  supportLevelEnum,
  supportSourceEnum,
  timestamps,
} from './_shared';
import { product, productVariant } from './product';
import { provenance } from './provenance';
import { silicon } from './silicon';
import { connectorStandard, formFactor, softwarePlatform } from './taxonomy';

/**
 * Claims that span entities: does this fit that, is it still made, does Linux drive it. All
 * three were found to be graded rather than boolean (findings 5, 11, 13), so each carries a
 * level plus the evidence behind it.
 */

/**
 * "Does X work with Y". Finding 5: the CM5 is described as a drop-in CM4 upgrade, yet seven
 * pins changed function — so the level and the deltas have to travel together.
 *
 * Exactly one of the three target columns is set: another product, a form factor, or an
 * expansion standard.
 */
export const compatibilityClaim = pgTable(
  'compatibility_claim',
  {
    id: text('id').primaryKey(),
    subjectProductId: text('subject_product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    targetProductId: text('target_product_id').references(() => product.id, {
      onDelete: 'cascade',
    }),
    targetFormFactorId: text('target_form_factor_id').references(() => formFactor.id, {
      onDelete: 'cascade',
    }),
    targetConnectorStandardId: text('target_connector_standard_id').references(
      () => connectorStandard.id,
      { onDelete: 'cascade' },
    ),
    level: compatibilityLevelEnum('level').notNull(),
    summary: text('summary').notNull().default(''),
    caveats: text('caveats').array().notNull().default([]),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('compatibility_claim_subject_idx').on(table.subjectProductId),
    index('compatibility_claim_target_product_idx').on(table.targetProductId),
    index('compatibility_claim_level_idx').on(table.level),
  ],
);

/** The per-signal exceptions behind a compatibility claim — "pin 16: SYNC_IN → FAN_TACHO". */
export const compatibilityDelta = pgTable(
  'compatibility_delta',
  {
    id: text('id').primaryKey(),
    claimId: text('claim_id')
      .notNull()
      .references(() => compatibilityClaim.id, { onDelete: 'cascade' }),
    /** `pin 16`, `pins 159/163/165`, `3V3 rail`. */
    signal: text('signal').notNull(),
    subjectFunction: text('subject_function').notNull().default(''),
    targetFunction: text('target_function').notNull().default(''),
    impact: text('impact').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [index('compatibility_delta_claim_idx').on(table.claimId)],
);

/**
 * A dated lifecycle transition. Set exactly one of `productId` / `siliconId`; a board and the
 * chip inside it age on different schedules.
 */
export const lifecycleEvent = pgTable(
  'lifecycle_event',
  {
    id: text('id').primaryKey(),
    productId: text('product_id').references(() => product.id, { onDelete: 'cascade' }),
    siliconId: text('silicon_id').references(() => silicon.id, { onDelete: 'cascade' }),
    state: lifecycleStateEnum('state').notNull(),
    effectiveAt: timestamp('effective_at'),
    announcedAt: timestamp('announced_at'),
    summary: text('summary').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('lifecycle_event_product_idx').on(table.productId),
    index('lifecycle_event_silicon_idx').on(table.siliconId),
    index('lifecycle_event_state_idx').on(table.state),
  ],
);

/**
 * A manufacturer's availability promise. Finding 11: "in production until **at least** January
 * 2036" is a minimum guarantee, not an EOL date, so the exact wording is stored beside the
 * date and the two are never conflated.
 */
export const longevityCommitment = pgTable(
  'longevity_commitment',
  {
    id: text('id').primaryKey(),
    productId: text('product_id').references(() => product.id, { onDelete: 'cascade' }),
    siliconId: text('silicon_id').references(() => silicon.id, { onDelete: 'cascade' }),
    /** `production`, `software support`, `component supply`. */
    scope: text('scope').notNull().default('production'),
    guaranteedUntil: timestamp('guaranteed_until'),
    /** Whether the date is a floor ("until at least") rather than a fixed end. */
    isMinimum: boolean('is_minimum').notNull().default(true),
    wording: text('wording').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('longevity_commitment_product_idx').on(table.productId),
    index('longevity_commitment_silicon_idx').on(table.siliconId),
  ],
);

/**
 * Support for one component, on one software platform. Finding 13: a board-level
 * "Linux: supported" boolean is the most misleading field this kind of catalog can ship, so
 * the unit is (product | silicon) × platform × component, with mainline and vendor tracked
 * separately.
 */
export const softwareSupportClaim = pgTable(
  'software_support_claim',
  {
    id: text('id').primaryKey(),
    productId: text('product_id').references(() => product.id, { onDelete: 'cascade' }),
    siliconId: text('silicon_id').references(() => silicon.id, { onDelete: 'cascade' }),
    softwarePlatformId: text('software_platform_id')
      .notNull()
      .references(() => softwarePlatform.id, { onDelete: 'cascade' }),
    /** `ethernet`, `gpu`, `npu`, `hdmi`, `suspend`, `video-decode`, or `overall`. */
    component: text('component').notNull(),
    level: supportLevelEnum('level').notNull(),
    source: supportSourceEnum('source').notNull().default('unknown'),
    /** Kernel/BSP/SDK version where it started working. */
    versionIntroduced: text('version_introduced').notNull().default(''),
    versionTested: text('version_tested').notNull().default(''),
    requiresBlob: boolean('requires_blob'),
    /** The toolchain that actually unlocks the block — RKNN, VIPLite, TensorRT, Mesa. */
    toolchain: text('toolchain').notNull().default(''),
    lastVerifiedAt: timestamp('last_verified_at'),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('software_support_claim_product_idx').on(table.productId),
    index('software_support_claim_silicon_idx').on(table.siliconId),
    index('software_support_claim_platform_idx').on(table.softwarePlatformId),
    index('software_support_claim_level_idx').on(table.level),
  ],
);

/**
 * A board revision and what changed in it. Two products with the same commercial name are not
 * necessarily the same hardware — silent PMIC, PHY, and RAM-vendor substitutions are routine.
 */
export const productRevision = pgTable(
  'product_revision',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').references(() => productVariant.id, { onDelete: 'set null' }),
    revision: text('revision').notNull(),
    releasedAt: timestamp('released_at'),
    sequence: integer('sequence'),
    summary: text('summary').notNull().default(''),
    changes: text('changes').array().notNull().default([]),
    errata: text('errata').array().notNull().default([]),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('product_revision_unique').on(table.productId, table.revision),
    index('product_revision_product_idx').on(table.productId),
  ],
);

export type CompatibilityClaim = typeof compatibilityClaim.$inferSelect;
export type NewCompatibilityClaim = typeof compatibilityClaim.$inferInsert;
export type CompatibilityDelta = typeof compatibilityDelta.$inferSelect;
export type NewCompatibilityDelta = typeof compatibilityDelta.$inferInsert;
export type LifecycleEvent = typeof lifecycleEvent.$inferSelect;
export type NewLifecycleEvent = typeof lifecycleEvent.$inferInsert;
export type LongevityCommitment = typeof longevityCommitment.$inferSelect;
export type NewLongevityCommitment = typeof longevityCommitment.$inferInsert;
export type SoftwareSupportClaim = typeof softwareSupportClaim.$inferSelect;
export type NewSoftwareSupportClaim = typeof softwareSupportClaim.$inferInsert;
export type ProductRevision = typeof productRevision.$inferSelect;
export type NewProductRevision = typeof productRevision.$inferInsert;
