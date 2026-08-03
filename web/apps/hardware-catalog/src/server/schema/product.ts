import { boolean, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

import {
  antennaTypeEnum,
  certificationAuthorityEnum,
  compositionRelationEnum,
  coolingRequirementEnum,
  formFactorConformanceEnum,
  interfaceKindEnum,
  memoryKindEnum,
  memoryMountingEnum,
  powerInputKindEnum,
  priceKindEnum,
  productImageKindEnum,
  productLinkKindEnum,
  productTierEnum,
  siliconRoleEnum,
  temperatureGradeEnum,
  timestamps,
} from './_shared';
import { provenance } from './provenance';
import { silicon, siliconVariant } from './silicon';
import { connectorStandard, formFactor, manufacturer } from './taxonomy';

/**
 * Physical products, from bare chips to complete kits. Finding 3: vendors stop at different
 * tiers (Espressif sells chip→module→devkit, Luckfox sells straight to a board), so one entity
 * with a `tier` plus a composition relation covers all of them, and certification recorded on
 * a module is inherited by every board that uses it instead of being copied fifty times.
 */

export const product = pgTable(
  'product',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    tier: productTierEnum('tier').notNull(),
    manufacturerId: text('manufacturer_id')
      .notNull()
      .references(() => manufacturer.id, { onDelete: 'restrict' }),
    /** The line a product belongs to: `Luckfox Pico`, `XIAO`, `Compute Module`. */
    familyName: text('family_name').notNull().default(''),
    announcedAt: timestamp('announced_at'),
    releasedAt: timestamp('released_at'),
    summary: text('summary').notNull().default(''),
    description: text('description').notNull().default(''),
    // Links are rows in `product_link`, not columns here: a product has many, of many kinds.
    /** Whether schematics/CAD are published — a real selection criterion for integrators. */
    openSourceHardware: boolean('open_source_hardware'),
    widthMm: text('width_mm'),
    lengthMm: text('length_mm'),
    heightMm: text('height_mm'),
    weightG: text('weight_g'),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('product_slug_unique').on(table.slug),
    index('product_tier_idx').on(table.tier),
    index('product_manufacturer_idx').on(table.manufacturerId),
    index('product_family_idx').on(table.familyName),
  ],
);

/**
 * The orderable SKU. Finding 6: Luckfox Pico Ultra is {wireless} × {PoE} = four SKUs, Cubie
 * A7Z is five RAM tiers × four storage tiers, and ESP32 modules differ by flash and antenna.
 * Vendor offers and prices attach here, never to `product`.
 */
export const productVariant = pgTable(
  'product_variant',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull().default(''),
    name: text('name').notNull(),
    ramMb: integer('ram_mb'),
    ramStandard: text('ram_standard').notNull().default(''),
    storageMb: integer('storage_mb'),
    storageKind: memoryKindEnum('storage_kind'),
    hasWireless: boolean('has_wireless'),
    antennaType: antennaTypeEnum('antenna_type'),
    /** Regional radio SKU (`EU`, `US`, `JP`) — decides where the variant may legally ship. */
    regionCode: text('region_code').notNull().default(''),
    temperatureGrade: temperatureGradeEnum('temperature_grade').notNull().default('unspecified'),
    bundledItems: text('bundled_items').array().notNull().default([]),
    isDefault: boolean('is_default').notNull().default(false),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('product_variant_product_idx').on(table.productId),
    index('product_variant_sku_idx').on(table.sku),
  ],
);

/**
 * How products stack: a module inside a board, a carrier for a module, a kit bundling both.
 * This is what makes capability inheritance (rule 1) a traversal rather than duplication.
 */
export const productComposition = pgTable(
  'product_composition',
  {
    id: text('id').primaryKey(),
    parentProductId: text('parent_product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    childProductId: text('child_product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    relation: compositionRelationEnum('relation').notNull(),
    quantity: integer('quantity').notNull().default(1),
    isOptional: boolean('is_optional').notNull().default(false),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('product_composition_unique').on(
      table.parentProductId,
      table.childProductId,
      table.relation,
    ),
    index('product_composition_parent_idx').on(table.parentProductId),
    index('product_composition_child_idx').on(table.childProductId),
  ],
);

/**
 * Which silicon a product carries, and in what role. Finding 4: Pi 5's USB 3.0, Gigabit
 * Ethernet, MIPI transceivers and 40-pin GPIO come from RP1 over PCIe 2.0 ×4 — not from
 * BCM2712 — so answering "does this board have USB 3?" means walking every attached chip.
 */
export const productSilicon = pgTable(
  'product_silicon',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    siliconId: text('silicon_id')
      .notNull()
      .references(() => silicon.id, { onDelete: 'restrict' }),
    siliconVariantId: text('silicon_variant_id').references(() => siliconVariant.id, {
      onDelete: 'set null',
    }),
    role: siliconRoleEnum('role').notNull(),
    quantity: integer('quantity').notNull().default(1),
    /** How this chip attaches to the primary one: `PCIe 2.0 x4`, `SDIO`, `UART + level shifter`. */
    interconnect: text('interconnect').notNull().default(''),
    clockMhz: integer('clock_mhz'),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('product_silicon_product_idx').on(table.productId),
    index('product_silicon_silicon_idx').on(table.siliconId),
    index('product_silicon_role_idx').on(table.role),
  ],
);

/** Memory fitted to a product (or to one of its variants), with the mounting tier of finding 2. */
export const productMemory = pgTable(
  'product_memory',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    /** Set when only one SKU has this configuration; null means it applies to every variant. */
    variantId: text('variant_id').references(() => productVariant.id, { onDelete: 'cascade' }),
    kind: memoryKindEnum('kind').notNull(),
    standard: text('standard').notNull().default(''),
    mounting: memoryMountingEnum('mounting').notNull(),
    capacityMb: integer('capacity_mb'),
    channels: integer('channels'),
    busWidthBits: integer('bus_width_bits'),
    dataRateMts: integer('data_rate_mts'),
    hasEcc: boolean('has_ecc'),
    isUpgradable: boolean('is_upgradable'),
    socketType: text('socket_type').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('product_memory_product_idx').on(table.productId),
    index('product_memory_variant_idx').on(table.variantId),
  ],
);

/** Storage fitted or offered: soldered eMMC, an SD slot, SPI NAND, an M.2 socket. */
export const productStorage = pgTable(
  'product_storage',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').references(() => productVariant.id, { onDelete: 'cascade' }),
    kind: memoryKindEnum('kind').notNull(),
    /** `eMMC 5.1`, `UFS 3.0 2-lane`, `PCIe 3.0 x1 NVMe`, `SDIO 3.0`. */
    interfaceSpec: text('interface_spec').notNull().default(''),
    capacityMb: integer('capacity_mb'),
    isRemovable: boolean('is_removable').notNull().default(false),
    isBootable: boolean('is_bootable'),
    /** M.2 key and length, or the SD form factor. */
    socketFormat: text('socket_format').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('product_storage_product_idx').on(table.productId),
    index('product_storage_variant_idx').on(table.variantId),
  ],
);

/**
 * What actually reaches a connector, and which chip provides it. This is the board-side half
 * of finding 5: the SoC may offer six USB controllers while the board routes two.
 */
export const productExposedInterface = pgTable(
  'product_exposed_interface',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    kind: interfaceKindEnum('kind').notNull(),
    /** Rule 2: every capability names the silicon behind it. */
    providedBySiliconId: text('provided_by_silicon_id').references(() => silicon.id, {
      onDelete: 'set null',
    }),
    count: integer('count').notNull().default(1),
    version: text('version').notNull().default(''),
    lanes: integer('lanes'),
    maxSpeedMbps: integer('max_speed_mbps'),
    /** The physical thing a user plugs into: `USB-A 3.0`, `FPC 15-pin`, `RJ45`, `header pin 12`. */
    connectorDescription: text('connector_description').notNull().default(''),
    connectorStandardId: text('connector_standard_id').references(() => connectorStandard.id, {
      onDelete: 'set null',
    }),
    /** True when the signal is only available on a header rather than a dedicated connector. */
    onExpansionHeader: boolean('on_expansion_header').notNull().default(false),
    signalVoltageMv: integer('signal_voltage_mv'),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('product_exposed_interface_product_idx').on(table.productId),
    index('product_exposed_interface_kind_idx').on(table.kind),
    index('product_exposed_interface_silicon_idx').on(table.providedBySiliconId),
  ],
);

/**
 * Somewhere to point a reader. A product has many links — the vendor's own page, the wiki, the
 * schematic, the shops that stock it — so they are rows rather than a fixed set of URL columns,
 * which is also what lets a regional distributor sit beside the manufacturer's page.
 */
export const productLink = pgTable(
  'product_link',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    /** Set when the link is specific to one SKU rather than the design. */
    variantId: text('variant_id').references(() => productVariant.id, { onDelete: 'cascade' }),
    kind: productLinkKindEnum('kind').notNull(),
    url: text('url').notNull(),
    label: text('label').notNull().default(''),
    /** Two-letter code when a link only serves one market (a regional distributor, say). */
    regionCode: text('region_code').notNull().default(''),
    languageCode: text('language_code').notNull().default(''),
    /** The one link to follow first for this kind. */
    isPrimary: boolean('is_primary').notNull().default(false),
    lastCheckedAt: timestamp('last_checked_at'),
    /** Populated when a check found the link dead, so rot is visible rather than silent. */
    isBroken: boolean('is_broken').notNull().default(false),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('product_link_url_unique').on(table.productId, table.url),
    index('product_link_product_idx').on(table.productId),
    index('product_link_kind_idx').on(table.kind),
  ],
);

/**
 * A picture of the product. `storageKey` points at our own copy in the shared Helix S3 bucket,
 * taken so the catalog keeps working when a vendor reorganises their site or blocks hotlinking;
 * `url` stays as the original location, and the attribution.
 */
export const productImage = pgTable(
  'product_image',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').references(() => productVariant.id, { onDelete: 'cascade' }),
    kind: productImageKindEnum('kind').notNull().default('photo'),
    /** Where the image came from. Kept even after mirroring, for credit and re-fetching. */
    url: text('url').notNull(),
    /** Object key in the shared Helix bucket. Null until the image has been mirrored. */
    storageKey: text('storage_key'),
    contentType: text('content_type').notNull().default(''),
    byteSize: integer('byte_size'),
    width: integer('width'),
    height: integer('height'),
    alt: text('alt').notNull().default(''),
    credit: text('credit').notNull().default(''),
    /** Licence of the image itself, which is rarely the licence of the hardware. */
    licence: text('licence').notNull().default(''),
    isPrimary: boolean('is_primary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('product_image_url_unique').on(table.productId, table.url),
    index('product_image_product_idx').on(table.productId),
    index('product_image_primary_idx').on(table.productId, table.isPrimary),
  ],
);

/**
 * One indicative price, per country. Deliberately not an offer table: there is exactly one row
 * per (product, variant, country), it is hand-entered, and it exists to answer "roughly what
 * does this cost here?" rather than "where do I buy it cheapest today".
 *
 * Amounts are integer minor units (cents, paise) because money in a float is a bug waiting to
 * happen. `includesTax` and `includesShipping` are not decoration: an Indian listing normally
 * includes GST and a US one normally excludes sales tax, so comparing the bare numbers across
 * countries without them is misleading.
 *
 * When live vendor offers arrive they belong in a separate table keyed to `product_variant`,
 * with history — these rows stay as the fallback estimate.
 */
export const priceEstimate = pgTable(
  'price_estimate',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    /** Null means the estimate covers the product generally rather than one SKU. */
    variantId: text('variant_id').references(() => productVariant.id, { onDelete: 'cascade' }),
    /** ISO 3166-1 alpha-2. */
    countryCode: text('country_code').notNull(),
    /** ISO 4217. Usually the country's own currency, but not always. */
    currencyCode: text('currency_code').notNull(),
    /** Minor units: 5999 USD cents = $59.99. */
    amountMinor: integer('amount_minor').notNull(),
    kind: priceKindEnum('kind').notNull().default('estimated'),
    includesTax: boolean('includes_tax'),
    includesShipping: boolean('includes_shipping'),
    /** Prices move; an estimate without a date is worthless within a year. */
    asOf: timestamp('as_of').defaultNow().notNull(),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    // One price per country per SKU — the "single estimate" rule, enforced.
    unique('price_estimate_scope_unique').on(table.productId, table.variantId, table.countryCode),
    index('price_estimate_product_idx').on(table.productId),
    index('price_estimate_country_idx').on(table.countryCode),
  ],
);

/** Physical connectors and headers present on the board, keyed to a standard where one applies. */
export const productConnector = pgTable(
  'product_connector',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    connectorStandardId: text('connector_standard_id').references(() => connectorStandard.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull().default(1),
    pinCount: integer('pin_count'),
    signalVoltageMv: integer('signal_voltage_mv'),
    position: text('position').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [index('product_connector_product_idx').on(table.productId)],
);

/**
 * A named power/performance configuration. Finding 7: Orin Nano Super's 7 W / 15 W / 25 W /
 * MAXN modes cap active core count, CPU clock and GPU clock together, and deliver up to 2× the
 * AI throughput on identical silicon — so every benchmark result must reference one of these.
 */
export const operatingMode = pgTable(
  'operating_mode',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').references(() => productVariant.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    powerBudgetW: text('power_budget_w'),
    activeCpuCores: integer('active_cpu_cores'),
    cpuClockCapMhz: integer('cpu_clock_cap_mhz'),
    gpuClockCapMhz: integer('gpu_clock_cap_mhz'),
    acceleratorClockCapMhz: integer('accelerator_clock_cap_mhz'),
    coolingRequirement: coolingRequirementEnum('cooling_requirement').notNull().default('unknown'),
    isDefault: boolean('is_default').notNull().default(false),
    /** How the mode is selected: `nvpmodel -m 2`, BIOS setting, device-tree overlay. */
    selectionMethod: text('selection_method').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('operating_mode_product_idx').on(table.productId),
    index('operating_mode_variant_idx').on(table.variantId),
  ],
);

/** How a product can be powered, and what it draws. Draw figures are per operating mode. */
export const productPower = pgTable(
  'product_power',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    inputKind: powerInputKindEnum('input_kind').notNull(),
    voltageMinMv: integer('voltage_min_mv'),
    voltageMaxMv: integer('voltage_max_mv'),
    maxCurrentMa: integer('max_current_ma'),
    pdProfile: text('pd_profile').notNull().default(''),
    recommendedSupplyW: text('recommended_supply_w'),
    isPrimary: boolean('is_primary').notNull().default(false),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [index('product_power_product_idx').on(table.productId)],
);

/** Measured or specified draw, always tied to the mode it applies to (finding 7). */
export const productPowerDraw = pgTable(
  'product_power_draw',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    operatingModeId: text('operating_mode_id').references(() => operatingMode.id, {
      onDelete: 'cascade',
    }),
    /** `idle`, `typical`, `max`, `deep sleep`, or a named workload. */
    scenario: text('scenario').notNull(),
    powerW: text('power_w'),
    currentMa: text('current_ma'),
    isMeasured: boolean('is_measured').notNull().default(false),
    conditions: text('conditions').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('product_power_draw_product_idx').on(table.productId),
    index('product_power_draw_mode_idx').on(table.operatingModeId),
  ],
);

/** Antennas, separate from radios: the WROOM-32E ships a PCB trace, the -32UE a u.FL socket. */
export const productAntenna = pgTable(
  'product_antenna',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').references(() => productVariant.id, { onDelete: 'cascade' }),
    type: antennaTypeEnum('type').notNull(),
    gainDbi: text('gain_dbi'),
    connector: text('connector').notNull().default(''),
    bands: text('bands').array().notNull().default([]),
    isIncluded: boolean('is_included'),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [index('product_antenna_product_idx').on(table.productId)],
);

/**
 * Regulatory approval. Recorded on the tier that holds it — a module's own FCC Single Modular
 * Approval is why board vendors buy modules instead of bare chips (finding 3).
 */
export const productCertification = pgTable(
  'product_certification',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').references(() => productVariant.id, { onDelete: 'cascade' }),
    authority: certificationAuthorityEnum('authority').notNull(),
    identifier: text('identifier').notNull().default(''),
    scope: text('scope').notNull().default(''),
    issuedAt: timestamp('issued_at'),
    expiresAt: timestamp('expires_at'),
    documentUrl: text('document_url').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    index('product_certification_product_idx').on(table.productId),
    index('product_certification_authority_idx').on(table.authority),
  ],
);

/** Which shared footprint a product conforms to, and how exactly (finding 12). */
export const productFormFactor = pgTable(
  'product_form_factor',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    formFactorId: text('form_factor_id')
      .notNull()
      .references(() => formFactor.id, { onDelete: 'cascade' }),
    conformance: formFactorConformanceEnum('conformance').notNull().default('exact'),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('product_form_factor_unique').on(table.productId, table.formFactorId),
    index('product_form_factor_form_factor_idx').on(table.formFactorId),
  ],
);

/** Environmental envelope — the field that separates a hobby board from an industrial one. */
export const productEnvironment = pgTable(
  'product_environment',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').references(() => productVariant.id, { onDelete: 'cascade' }),
    operatingTempMinC: integer('operating_temp_min_c'),
    operatingTempMaxC: integer('operating_temp_max_c'),
    storageTempMinC: integer('storage_temp_min_c'),
    storageTempMaxC: integer('storage_temp_max_c'),
    humidityMaxPct: integer('humidity_max_pct'),
    hasConformalCoating: boolean('has_conformal_coating'),
    ingressRating: text('ingress_rating').notNull().default(''),
    shockVibrationSpec: text('shock_vibration_spec').notNull().default(''),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [index('product_environment_product_idx').on(table.productId)],
);

export type Product = typeof product.$inferSelect;
export type NewProduct = typeof product.$inferInsert;
export type ProductVariant = typeof productVariant.$inferSelect;
export type NewProductVariant = typeof productVariant.$inferInsert;
export type PriceEstimate = typeof priceEstimate.$inferSelect;
export type NewPriceEstimate = typeof priceEstimate.$inferInsert;
export type ProductLink = typeof productLink.$inferSelect;
export type NewProductLink = typeof productLink.$inferInsert;
export type ProductImage = typeof productImage.$inferSelect;
export type NewProductImage = typeof productImage.$inferInsert;
export type ProductSilicon = typeof productSilicon.$inferSelect;
export type NewProductSilicon = typeof productSilicon.$inferInsert;
export type ProductExposedInterface = typeof productExposedInterface.$inferSelect;
export type NewProductExposedInterface = typeof productExposedInterface.$inferInsert;
export type OperatingMode = typeof operatingMode.$inferSelect;
export type NewOperatingMode = typeof operatingMode.$inferInsert;
