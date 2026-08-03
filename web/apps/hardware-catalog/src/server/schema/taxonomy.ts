import { boolean, index, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';

import {
  coreKindEnum,
  connectorKindEnum,
  executionOrderEnum,
  isaFamilyEnum,
  isaProfileEnum,
  softwarePlatformKindEnum,
  timestamps,
} from './_shared';
import { provenance } from './provenance';

/**
 * Shared vocabulary: the entities that silicon and products both point at. Keeping these as
 * rows rather than strings is what makes "every board using a Cortex-A76" or "everything that
 * fits a XIAO footprint" a join instead of a text search.
 */

export const manufacturer = pgTable(
  'manufacturer',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    legalName: text('legal_name').notNull().default(''),
    countryCode: text('country_code').notNull().default(''),
    websiteUrl: text('website_url').notNull().default(''),
    /** A vendor can be several of these at once (Raspberry Pi designs silicon and boards). */
    designsSilicon: boolean('designs_silicon').notNull().default(false),
    designsProducts: boolean('designs_products').notNull().default(false),
    description: text('description').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [unique('manufacturer_slug_unique').on(table.slug)],
);

/** An instruction-set architecture — ARMv8-A, RV64GC, Xtensa LX7, AVR. */
export const architecture = pgTable(
  'architecture',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    family: isaFamilyEnum('family').notNull(),
    profile: isaProfileEnum('profile').notNull().default('unspecified'),
    bits: integer('bits'),
    /** Base ISA string where one exists, e.g. `RV64IMAFDC`. */
    baseIsa: text('base_isa').notNull().default(''),
    /** NEON, SVE2, RVV 1.0, DSP, MVE — the extensions that decide whether code runs. */
    extensions: text('extensions').array().notNull().default([]),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('architecture_slug_unique').on(table.slug),
    index('architecture_family_idx').on(table.family),
  ],
);

/**
 * A reusable core design — Cortex-A76, Hazard3, PowerVR BXM-4-64, XuanTie E902, Vivante
 * VIP9000. Separate from `silicon` so "compare A76 against A78" and "every SoC with an A55
 * cluster" are answerable without touching board data.
 */
export const coreDesign = pgTable(
  'core_design',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: coreKindEnum('kind').notNull(),
    /** Null for GPU/NPU/ISP designs, which have no ISA in the CPU sense. */
    architectureId: text('architecture_id').references(() => architecture.id, {
      onDelete: 'set null',
    }),
    designerId: text('designer_id').references(() => manufacturer.id, { onDelete: 'set null' }),
    microarchitecture: text('microarchitecture').notNull().default(''),
    executionOrder: executionOrderEnum('execution_order').notNull().default('unknown'),
    issueWidth: integer('issue_width'),
    pipelineStages: integer('pipeline_stages'),
    l1InstructionKb: integer('l1_instruction_kb'),
    l1DataKb: integer('l1_data_kb'),
    /** Typical private L2 for this design; the actual per-SoC value lives on the compute unit. */
    l2Kb: integer('l2_kb'),
    simdExtensions: text('simd_extensions').array().notNull().default([]),
    hasFpu: boolean('has_fpu'),
    hasMmu: boolean('has_mmu'),
    hasMpu: boolean('has_mpu'),
    supportsVirtualization: boolean('supports_virtualization'),
    maxClockMhz: integer('max_clock_mhz'),
    launchYear: integer('launch_year'),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('core_design_slug_unique').on(table.slug),
    index('core_design_kind_idx').on(table.kind),
    index('core_design_architecture_idx').on(table.architectureId),
  ],
);

/**
 * A shared mechanical/electrical standard — the XIAO 21×17.5 mm footprint, CM4/CM5,
 * SMARC 2.1, Pico-ITX, 96Boards CE. Finding 12: the footprint is the reusable asset, so it is
 * an entity that many products point at.
 */
export const formFactor = pgTable(
  'form_factor',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    standardBody: text('standard_body').notNull().default(''),
    version: text('version').notNull().default(''),
    widthMm: integer('width_mm'),
    lengthMm: integer('length_mm'),
    maxHeightMm: integer('max_height_mm'),
    /** How the module or board mates: "2× 100-pin high-density", "castellated 112-pin". */
    mountingSummary: text('mounting_summary').notNull().default(''),
    specUrl: text('spec_url').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [unique('form_factor_slug_unique').on(table.slug)],
);

/** An expansion or interconnect standard — 40-pin HAT, mikroBUS, Qwiic, M.2 M-key, mPCIe. */
export const connectorStandard = pgTable(
  'connector_standard',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: connectorKindEnum('kind').notNull(),
    pinCount: integer('pin_count'),
    /** Logic level the standard mandates, in millivolts, so 1.8/3.3/5 V compare numerically. */
    signalVoltageMv: integer('signal_voltage_mv'),
    keying: text('keying').notNull().default(''),
    specUrl: text('spec_url').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('connector_standard_slug_unique').on(table.slug),
    index('connector_standard_kind_idx').on(table.kind),
  ],
);

/**
 * Anything support can be claimed against: a kernel, a distro, an RTOS, a bootloader, or an
 * inference SDK. Finding 8 put the SDK here deliberately — RKNN/VIPLite availability decides
 * whether an NPU is usable at all.
 */
export const softwarePlatform = pgTable(
  'software_platform',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: softwarePlatformKindEnum('kind').notNull(),
    vendorId: text('vendor_id').references(() => manufacturer.id, { onDelete: 'set null' }),
    websiteUrl: text('website_url').notNull().default(''),
    isOpenSource: boolean('is_open_source'),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('software_platform_slug_unique').on(table.slug),
    index('software_platform_kind_idx').on(table.kind),
  ],
);

export type Manufacturer = typeof manufacturer.$inferSelect;
export type NewManufacturer = typeof manufacturer.$inferInsert;
export type Architecture = typeof architecture.$inferSelect;
export type NewArchitecture = typeof architecture.$inferInsert;
export type CoreDesign = typeof coreDesign.$inferSelect;
export type NewCoreDesign = typeof coreDesign.$inferInsert;
export type FormFactor = typeof formFactor.$inferSelect;
export type NewFormFactor = typeof formFactor.$inferInsert;
export type ConnectorStandard = typeof connectorStandard.$inferSelect;
export type NewConnectorStandard = typeof connectorStandard.$inferInsert;
export type SoftwarePlatform = typeof softwarePlatform.$inferSelect;
export type NewSoftwarePlatform = typeof softwarePlatform.$inferInsert;
