import { boolean, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

import {
  codecDirectionEnum,
  codecFormatEnum,
  computeRoleEnum,
  coreKindEnum,
  interfaceKindEnum,
  memoryKindEnum,
  memoryMountingEnum,
  performanceUnitEnum,
  precisionEnum,
  radioStandardEnum,
  securityFeatureKindEnum,
  siliconKindEnum,
  temperatureGradeEnum,
  timestamps,
} from './_shared';
import { provenance } from './provenance';
import { coreDesign, manufacturer } from './taxonomy';

/**
 * Silicon: what a die can do, independent of any board. Everything a chip provides is a child
 * row, because finding 1 (heterogeneous engines), 9 (encode ≠ decode), and 8 (TOPS needs a
 * precision) each break the single-wide-table model.
 */

export const silicon = pgTable(
  'silicon',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: siliconKindEnum('kind').notNull(),
    manufacturerId: text('manufacturer_id')
      .notNull()
      .references(() => manufacturer.id, { onDelete: 'restrict' }),
    /** The marketing family, e.g. `RK35xx`, `ESP32-S`, `STM32F1`. */
    partFamily: text('part_family').notNull().default(''),
    processNodeNm: integer('process_node_nm'),
    processFoundry: text('process_foundry').notNull().default(''),
    announcedAt: timestamp('announced_at'),
    summary: text('summary').notNull().default(''),
    description: text('description').notNull().default(''),
    productUrl: text('product_url').notNull().default(''),
    datasheetUrl: text('datasheet_url').notNull().default(''),
    referenceManualUrl: text('reference_manual_url').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('silicon_slug_unique').on(table.slug),
    index('silicon_kind_idx').on(table.kind),
    index('silicon_manufacturer_idx').on(table.manufacturerId),
    index('silicon_part_family_idx').on(table.partFamily),
  ],
);

/**
 * An orderable part number for a design. Finding 6: STM32 encodes pin count, flash, package
 * and temperature grade *in the ordering code*, and RK3588/RK3588S/RK3588J differ by grade and
 * operating points — so one `silicon` row has many buyable forms.
 */
export const siliconVariant = pgTable(
  'silicon_variant',
  {
    id: text('id').primaryKey(),
    siliconId: text('silicon_id')
      .notNull()
      .references(() => silicon.id, { onDelete: 'cascade' }),
    orderingCode: text('ordering_code').notNull(),
    name: text('name').notNull().default(''),
    temperatureGrade: temperatureGradeEnum('temperature_grade').notNull().default('unspecified'),
    tempMinC: integer('temp_min_c'),
    tempMaxC: integer('temp_max_c'),
    packageType: text('package_type').notNull().default(''),
    pinCount: integer('pin_count'),
    /** Speed bin ceiling; RK3588J drops overdrive operating points relative to RK3588. */
    maxClockMhz: integer('max_clock_mhz'),
    onDieFlashKb: integer('on_die_flash_kb'),
    onDieRamKb: integer('on_die_ram_kb'),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('silicon_variant_ordering_code_unique').on(table.orderingCode),
    index('silicon_variant_silicon_idx').on(table.siliconId),
    index('silicon_variant_temperature_grade_idx').on(table.temperatureGrade),
  ],
);

/**
 * One compute engine on the die. Finding 1: an SoC is a bag of these, and some of them are
 * mutually exclusive — RP2350's Arm and RISC-V pairs are selected via software or OTP, and
 * SG2002's main core is C906 *or* Cortex-A53 at boot. Rows sharing an `alternativeGroup` are
 * alternatives to each other, so a UI renders "Arm **or** RISC-V" instead of listing cores
 * that never run together.
 */
export const siliconComputeUnit = pgTable(
  'silicon_compute_unit',
  {
    id: text('id').primaryKey(),
    siliconId: text('silicon_id')
      .notNull()
      .references(() => silicon.id, { onDelete: 'cascade' }),
    kind: coreKindEnum('kind').notNull(),
    role: computeRoleEnum('role').notNull(),
    coreDesignId: text('core_design_id').references(() => coreDesign.id, { onDelete: 'set null' }),
    /** Human label for the cluster: "big cluster", "LP core", "always-on RISC-V". */
    label: text('label').notNull().default(''),
    coreCount: integer('core_count').notNull().default(1),
    minClockMhz: integer('min_clock_mhz'),
    maxClockMhz: integer('max_clock_mhz'),
    l1InstructionKb: integer('l1_instruction_kb'),
    l1DataKb: integer('l1_data_kb'),
    l2Kb: integer('l2_kb'),
    l3Kb: integer('l3_kb'),
    /** Shared key across mutually exclusive units; null means the unit is always present. */
    alternativeGroup: text('alternative_group'),
    /** Which alternative ships enabled by default (RP2350 boots Arm unless OTP says otherwise). */
    isDefaultAlternative: boolean('is_default_alternative').notNull().default(false),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('silicon_compute_unit_silicon_idx').on(table.siliconId),
    index('silicon_compute_unit_core_design_idx').on(table.coreDesignId),
    index('silicon_compute_unit_kind_idx').on(table.kind),
    index('silicon_compute_unit_alternative_idx').on(table.siliconId, table.alternativeGroup),
  ],
);

/**
 * What memory the die supports, and where it sits. Finding 2: RV1103's 64 MB is on-die and
 * RV1106's 128/256 MB is in-package, which makes them silicon facts; an SBC's LPDDR is a board
 * fact. Both are recorded with an explicit mounting so neither is mistaken for the other.
 */
export const siliconMemorySupport = pgTable(
  'silicon_memory_support',
  {
    id: text('id').primaryKey(),
    siliconId: text('silicon_id')
      .notNull()
      .references(() => silicon.id, { onDelete: 'cascade' }),
    kind: memoryKindEnum('kind').notNull(),
    /** `LPDDR4X`, `DDR3L`, `SRAM`, `QSPI NOR`. */
    standard: text('standard').notNull().default(''),
    mounting: memoryMountingEnum('mounting').notNull(),
    /** Set when the memory is in-die or in-package, i.e. the capacity is fixed by the part. */
    capacityMb: integer('capacity_mb'),
    maxCapacityMb: integer('max_capacity_mb'),
    channels: integer('channels'),
    busWidthBits: integer('bus_width_bits'),
    maxDataRateMts: integer('max_data_rate_mts'),
    maxBandwidthMbps: integer('max_bandwidth_mbps'),
    supportsEcc: boolean('supports_ecc'),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('silicon_memory_support_silicon_idx').on(table.siliconId),
    index('silicon_memory_support_kind_idx').on(table.kind),
  ],
);

/**
 * A peripheral the die provides. This is *capability*, not exposure — how much of it reaches a
 * connector is `productExposedInterface` (finding 5).
 */
export const siliconInterface = pgTable(
  'silicon_interface',
  {
    id: text('id').primaryKey(),
    siliconId: text('silicon_id')
      .notNull()
      .references(() => silicon.id, { onDelete: 'cascade' }),
    kind: interfaceKindEnum('kind').notNull(),
    count: integer('count').notNull().default(1),
    /** `PCIe 2.0`, `USB 2.0 OTG`, `CAN-FD`, `MIPI CSI-2 4-lane`. */
    version: text('version').notNull().default(''),
    lanes: integer('lanes'),
    maxSpeedMbps: integer('max_speed_mbps'),
    /** Pads are usually multiplexed; this records what the interface competes with. */
    muxNotes: text('mux_notes').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('silicon_interface_silicon_idx').on(table.siliconId),
    index('silicon_interface_kind_idx').on(table.kind),
  ],
);

/**
 * One codec in one direction. Finding 9: SG2002 decodes H.264 and encodes H.265 but does not
 * decode it — a single "H.265: yes" would promise playback the part cannot do.
 */
export const siliconMediaCodec = pgTable(
  'silicon_media_codec',
  {
    id: text('id').primaryKey(),
    siliconId: text('silicon_id')
      .notNull()
      .references(() => silicon.id, { onDelete: 'cascade' }),
    format: codecFormatEnum('format').notNull(),
    direction: codecDirectionEnum('direction').notNull(),
    profile: text('profile').notNull().default(''),
    maxWidth: integer('max_width'),
    maxHeight: integer('max_height'),
    maxFps: integer('max_fps'),
    maxStreams: integer('max_streams'),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('silicon_media_codec_silicon_idx').on(table.siliconId),
    index('silicon_media_codec_format_idx').on(table.format, table.direction),
  ],
);

/**
 * Image signal processor capability. Its own table because on the nano-Linux camera boards
 * (RV1106, SG2002) the ISP, not the CPU, is the reason to choose the part.
 */
export const siliconIsp = pgTable(
  'silicon_isp',
  {
    id: text('id').primaryKey(),
    siliconId: text('silicon_id')
      .notNull()
      .references(() => silicon.id, { onDelete: 'cascade' }),
    generation: text('generation').notNull().default(''),
    maxSensorMp: integer('max_sensor_mp'),
    maxLanes: integer('max_lanes'),
    maxConcurrentSensors: integer('max_concurrent_sensors'),
    /** HDR, WDR, 3DNR, defog, lens-distortion correction. */
    features: text('features').array().notNull().default([]),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [index('silicon_isp_silicon_idx').on(table.siliconId)],
);

/**
 * Throughput of an accelerator at one precision. Finding 8: RV1106 is 0.5 TOPS at int8 and
 * double that at int4, so the number is meaningless without the precision it was measured at.
 * Attached to the compute unit, not the silicon, because a die can hold several accelerators.
 */
export const siliconAcceleratorPerformance = pgTable(
  'silicon_accelerator_performance',
  {
    id: text('id').primaryKey(),
    computeUnitId: text('compute_unit_id')
      .notNull()
      .references(() => siliconComputeUnit.id, { onDelete: 'cascade' }),
    precision: precisionEnum('precision').notNull(),
    value: text('value').notNull(),
    unit: performanceUnitEnum('unit').notNull(),
    /** Clock, sparsity, or power assumptions behind the figure. */
    conditions: text('conditions').notNull().default(''),
    isVendorClaim: boolean('is_vendor_claim').notNull().default(true),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('silicon_accelerator_performance_unit_idx').on(table.computeUnitId),
    index('silicon_accelerator_performance_precision_idx').on(table.precision),
  ],
);

/** Precisions an accelerator can execute, independent of any published throughput figure. */
export const siliconAcceleratorPrecision = pgTable(
  'silicon_accelerator_precision',
  {
    id: text('id').primaryKey(),
    computeUnitId: text('compute_unit_id')
      .notNull()
      .references(() => siliconComputeUnit.id, { onDelete: 'cascade' }),
    precision: precisionEnum('precision').notNull(),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('silicon_accelerator_precision_unique').on(table.computeUnitId, table.precision),
  ],
);

/**
 * A radio integrated on the die. Finding 10: ESP32-C6 carries Wi-Fi 6, BLE 5.3 and 802.15.4
 * on one part while ESP32-P4 carries none, so radios are rows owned by whichever tier holds
 * them and inherited by anything built on top.
 */
export const siliconRadio = pgTable(
  'silicon_radio',
  {
    id: text('id').primaryKey(),
    siliconId: text('silicon_id')
      .notNull()
      .references(() => silicon.id, { onDelete: 'cascade' }),
    standard: radioStandardEnum('standard').notNull(),
    /** Marketing generation: `Wi-Fi 6`, `Bluetooth 5.3`. */
    generation: text('generation').notNull().default(''),
    /** Underlying spec: `802.11ax`, `802.15.4-2015`. */
    specName: text('spec_name').notNull().default(''),
    bands: text('bands').array().notNull().default([]),
    spatialStreams: integer('spatial_streams'),
    maxPhyRateMbps: integer('max_phy_rate_mbps'),
    /** Application protocols the radio is certified or claimed to carry (Thread, Zigbee, Matter). */
    protocols: text('protocols').array().notNull().default([]),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('silicon_radio_silicon_idx').on(table.siliconId),
    index('silicon_radio_standard_idx').on(table.standard),
  ],
);

export const siliconSecurityFeature = pgTable(
  'silicon_security_feature',
  {
    id: text('id').primaryKey(),
    siliconId: text('silicon_id')
      .notNull()
      .references(() => silicon.id, { onDelete: 'cascade' }),
    kind: securityFeatureKindEnum('kind').notNull(),
    detail: text('detail').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('silicon_security_feature_unique').on(table.siliconId, table.kind),
    index('silicon_security_feature_kind_idx').on(table.kind),
  ],
);

export type Silicon = typeof silicon.$inferSelect;
export type NewSilicon = typeof silicon.$inferInsert;
export type SiliconVariant = typeof siliconVariant.$inferSelect;
export type NewSiliconVariant = typeof siliconVariant.$inferInsert;
export type SiliconComputeUnit = typeof siliconComputeUnit.$inferSelect;
export type NewSiliconComputeUnit = typeof siliconComputeUnit.$inferInsert;
export type SiliconMemorySupport = typeof siliconMemorySupport.$inferSelect;
export type NewSiliconMemorySupport = typeof siliconMemorySupport.$inferInsert;
export type SiliconInterface = typeof siliconInterface.$inferSelect;
export type NewSiliconInterface = typeof siliconInterface.$inferInsert;
export type SiliconMediaCodec = typeof siliconMediaCodec.$inferSelect;
export type NewSiliconMediaCodec = typeof siliconMediaCodec.$inferInsert;
export type SiliconIsp = typeof siliconIsp.$inferSelect;
export type NewSiliconIsp = typeof siliconIsp.$inferInsert;
export type SiliconAcceleratorPerformance = typeof siliconAcceleratorPerformance.$inferSelect;
export type NewSiliconAcceleratorPerformance = typeof siliconAcceleratorPerformance.$inferInsert;
export type SiliconRadio = typeof siliconRadio.$inferSelect;
export type NewSiliconRadio = typeof siliconRadio.$inferInsert;
export type SiliconSecurityFeature = typeof siliconSecurityFeature.$inferSelect;
export type NewSiliconSecurityFeature = typeof siliconSecurityFeature.$inferInsert;
