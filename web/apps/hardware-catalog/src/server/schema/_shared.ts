import { pgEnum, timestamp } from 'drizzle-orm/pg-core';

/**
 * Enums and column helpers shared across the catalog schema. Every enum here exists because
 * `docs/20-Hardware-Catalog-Data-Model-Research.md` found a real part that a free-text column
 * or a boolean would misrepresent; the finding number is cited on each.
 */

/** Row bookkeeping. Spread into every table. */
export const timestamps = {
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
};

// ── Taxonomy ────────────────────────────────────────────────────────────────────────────

/** ISA family. Xtensa and AVR are here because Espressif and classic Arduino are in scope. */
export const isaFamilyEnum = pgEnum('isa_family', [
  'arm',
  'riscv',
  'x86',
  'xtensa',
  'avr',
  'mips',
  'pic',
  'proprietary',
  'other',
]);

/** Arm's A/R/M split generalised: what class of software the ISA profile is meant to run. */
export const isaProfileEnum = pgEnum('isa_profile', [
  'application',
  'realtime',
  'microcontroller',
  'unspecified',
]);

/** What kind of engine a core design describes — CPU, GPU, NPU, and the fixed-function blocks. */
export const coreKindEnum = pgEnum('core_kind', [
  'cpu',
  'gpu',
  'npu',
  'dsp',
  'isp',
  'video_engine',
  'fpga',
  'security_core',
  'radio_baseband',
  'other',
]);

export const executionOrderEnum = pgEnum('execution_order', [
  'in_order',
  'out_of_order',
  'unknown',
]);

/** Whether a form factor / connector standard is mechanical, electrical, or both. */
export const connectorKindEnum = pgEnum('connector_kind', [
  'expansion_header',
  'module_socket',
  'storage',
  'display',
  'camera',
  'network',
  'power',
  'debug',
  'audio',
  'usb',
  'antenna',
  'other',
]);

/** Software the catalog tracks support against — an OS is only one of the things that matters. */
export const softwarePlatformKindEnum = pgEnum('software_platform_kind', [
  'linux_kernel',
  'linux_distro',
  'rtos',
  'bare_metal_sdk',
  'android',
  'bootloader',
  'bsp',
  'toolchain',
  'inference_runtime',
  'container_runtime',
  'other',
]);

// ── Silicon ─────────────────────────────────────────────────────────────────────────────

/** What a piece of silicon *is*. `io_controller` exists because of RP1 (finding 4). */
export const siliconKindEnum = pgEnum('silicon_kind', [
  'soc',
  'mcu',
  'mpu',
  'wireless_soc',
  'io_controller',
  'fpga',
  'secure_element',
  'pmic',
  'ethernet_phy',
  'audio_codec',
  'display_bridge',
  'usb_controller',
  'storage_controller',
  'sensor',
  'accelerator',
  'other',
]);

/** The job an engine does on the die. Finding 1: one silicon holds several at once. */
export const computeRoleEnum = pgEnum('compute_role', [
  'application',
  'realtime',
  'low_power',
  'always_on',
  'security',
  'accelerator',
  'graphics',
  'imaging',
  'media',
  'io',
  'other',
]);

/** Finding 2: where the memory physically is decides who owns the fact and whether it changes. */
export const memoryMountingEnum = pgEnum('memory_mounting', [
  'on_die',
  'in_package_sip',
  'on_module',
  'on_board_soldered',
  'socketed',
  'removable',
]);

export const memoryKindEnum = pgEnum('memory_kind', [
  'sram',
  'dram',
  'psram',
  'flash_nor',
  'flash_nand',
  'emmc',
  'ufs',
  'nvme',
  'sata',
  'sd_card',
  'eeprom',
  'fram',
  'rom',
]);

/** Peripheral/interface taxonomy, used both for silicon capability and board exposure. */
export const interfaceKindEnum = pgEnum('interface_kind', [
  'usb',
  'usb_otg',
  'pcie',
  'ethernet',
  'sata',
  'sdio',
  'sdmmc',
  'emmc',
  'qspi',
  'i2c',
  'i3c',
  'spi',
  'uart',
  'can',
  'canfd',
  'rs232',
  'rs485',
  'onewire',
  'i2s',
  'pdm',
  'pwm',
  'adc',
  'dac',
  'gpio',
  'mipi_csi',
  'mipi_dsi',
  'hdmi',
  'displayport',
  'edp',
  'lvds',
  'rgb_parallel',
  'composite_video',
  'jtag',
  'swd',
  'rtc',
  'watchdog',
  'dma',
  'crypto',
  'trng',
  'other',
]);

export const codecFormatEnum = pgEnum('codec_format', [
  'h264',
  'h265',
  'h266',
  'av1',
  'vp8',
  'vp9',
  'mpeg2',
  'mpeg4',
  'vc1',
  'mjpeg',
  'jpeg',
  'webp',
  'other',
]);

/** Finding 9: SG2002 decodes H.264 but only *encodes* H.265. Direction is a separate row. */
export const codecDirectionEnum = pgEnum('codec_direction', ['decode', 'encode']);

/** Finding 8: TOPS without a precision is meaningless. */
export const precisionEnum = pgEnum('precision', [
  'int4',
  'int8',
  'int16',
  'int32',
  'fp8',
  'fp16',
  'bf16',
  'fp32',
  'fp64',
  'mixed',
]);

export const performanceUnitEnum = pgEnum('performance_unit', [
  'tops',
  'gops',
  'gflops',
  'tflops',
  'mflops',
]);

export const radioStandardEnum = pgEnum('radio_standard', [
  'wifi',
  'bluetooth',
  'bluetooth_le',
  'ieee_802_15_4',
  'thread',
  'zigbee',
  'matter',
  'lora',
  'lorawan',
  'cellular',
  'nfc',
  'gnss',
  'uwb',
  'sub_ghz',
  'other',
]);

export const securityFeatureKindEnum = pgEnum('security_feature_kind', [
  'secure_boot',
  'measured_boot',
  'trustzone',
  'tpm',
  'secure_element',
  'hardware_rng',
  'crypto_accelerator',
  'otp_fuses',
  'flash_encryption',
  'memory_encryption',
  'debug_lock',
  'readout_protection',
  'rollback_protection',
  'secure_storage',
  'attestation',
  'unique_device_id',
  'iommu',
  'mpu',
  'ecc_memory',
  'anti_cloning',
  'other',
]);

/** Finding 6: temperature grade is a position in the ordering code, not a board property. */
export const temperatureGradeEnum = pgEnum('temperature_grade', [
  'commercial',
  'industrial',
  'extended',
  'automotive',
  'military',
  'unspecified',
]);

// ── Products ────────────────────────────────────────────────────────────────────────────

/** Finding 3: vendors stop at different tiers, so one entity spans all of them. */
export const productTierEnum = pgEnum('product_tier', [
  'chip',
  'module',
  'som',
  'board',
  'carrier',
  'kit',
  'accessory',
]);

/** Finding 4: a board holds several chips, and the role decides which one answers a question. */
export const siliconRoleEnum = pgEnum('silicon_role', [
  'application',
  'io_controller',
  'radio',
  'realtime_mcu',
  'coprocessor',
  'secure_element',
  'pmic',
  'ethernet_phy',
  'audio_codec',
  'display_bridge',
  'usb_controller',
  'storage_controller',
  'sensor',
  'accelerator',
  'other',
]);

/**
 * Where a link points. A product has many — the vendor's own page, its wiki, the schematic,
 * the shops that stock it — and which kind a link is decides how much it can be trusted and
 * where it belongs in the UI.
 */
export const productLinkKindEnum = pgEnum('product_link_kind', [
  'official_product',
  'documentation',
  'datasheet',
  'schematic',
  'wiki',
  'source_repository',
  'os_image',
  'driver_download',
  'cad_model',
  'certification',
  'store',
  'distributor',
  'forum',
  'review',
  'video',
  'other',
]);

/**
 * What a price actually is. Today everything is `estimated` — a single hand-entered figure per
 * country for rough budgeting — but the distinction is recorded from the start so that live
 * vendor offers can land beside estimates later without either being mistaken for the other.
 */
export const priceKindEnum = pgEnum('price_kind', [
  'estimated',
  'msrp',
  'street',
  'promotional',
  'observed_offer',
]);

/** What an image actually shows — a marketing render and a pinout diagram are not interchangeable. */
export const productImageKindEnum = pgEnum('product_image_kind', [
  'photo',
  'render',
  'board_layout',
  'pinout',
  'block_diagram',
  'dimensions',
  'packaging',
  'detail',
]);

export const compositionRelationEnum = pgEnum('composition_relation', [
  'contains_module',
  'carrier_for',
  'bundled_with',
  'requires',
  'successor_of',
  'variant_family_of',
]);

export const powerInputKindEnum = pgEnum('power_input_kind', [
  'usb_c_pd',
  'usb_c_5v',
  'usb_micro',
  'barrel_jack',
  'terminal_block',
  'header_pins',
  'poe',
  'poe_plus',
  'molex',
  'battery',
  'module_connector',
  'other',
]);

export const antennaTypeEnum = pgEnum('antenna_type', [
  'pcb_trace',
  'chip',
  'ufl_ipex',
  'sma',
  'rp_sma',
  'external_module',
  'none',
  'unknown',
]);

export const certificationAuthorityEnum = pgEnum('certification_authority', [
  'fcc',
  'ce',
  'red',
  'ukca',
  'ic_ised',
  'telec_mic',
  'kc',
  'anatel',
  'bis',
  'srrc',
  'rcm',
  'rohs',
  'reach',
  'weee',
  'ul',
  'other',
]);

export const coolingRequirementEnum = pgEnum('cooling_requirement', [
  'none',
  'passive_heatsink',
  'active_fan',
  'heatsink_and_fan',
  'chassis_conduction',
  'unknown',
]);

export const formFactorConformanceEnum = pgEnum('form_factor_conformance', [
  'exact',
  'derived',
  'inspired',
  'claimed',
]);

// ── Relationships and support ───────────────────────────────────────────────────────────

/**
 * Finding 5: "CM5 fits a CM4 carrier" is true mechanically and false for seven specific pins.
 * Compatibility is a level, never a boolean.
 */
export const compatibilityLevelEnum = pgEnum('compatibility_level', [
  'incompatible',
  'unknown',
  'community_reported',
  'vendor_claimed',
  'mechanical',
  'electrical',
  'pin_compatible',
  'driver_compatible',
  'fully_tested',
]);

export const lifecycleStateEnum = pgEnum('lifecycle_state', [
  'announced',
  'sampling',
  'active',
  'mature',
  'nrnd',
  'last_time_buy',
  'eol',
  'discontinued',
  'cancelled',
]);

/** Finding 13: support is per component, and "partial" is the most common honest answer. */
export const supportLevelEnum = pgEnum('support_level', [
  'unsupported',
  'broken',
  'partial',
  'supported',
  'unknown',
]);

/** Where the support comes from — mainline and a vendor fork are very different promises. */
export const supportSourceEnum = pgEnum('support_source', [
  'mainline',
  'vendor_kernel',
  'vendor_sdk',
  'third_party',
  'community',
  'unknown',
]);

// ── Provenance and editorial ────────────────────────────────────────────────────────────

/** Trust hierarchy for evidence. Ordering matters: earlier entries outrank later ones. */
export const sourceTypeEnum = pgEnum('source_type', [
  'datasheet',
  'reference_manual',
  'schematic',
  'official_product_page',
  'official_documentation',
  'official_repository',
  'errata',
  'distributor_page',
  'certified_benchmark',
  'lab_measurement',
  'technical_review',
  'community_report',
  'marketplace_listing',
  'other',
]);

export const confidenceEnum = pgEnum('confidence', ['low', 'medium', 'high', 'verified']);

export const actorKindEnum = pgEnum('actor_kind', ['human', 'agent', 'import', 'system']);

/** Conflicting values are kept side by side rather than overwritten (research doc §9). */
export const claimStatusEnum = pgEnum('claim_status', [
  'proposed',
  'accepted',
  'disputed',
  'rejected',
  'superseded',
]);

export const proposalStatusEnum = pgEnum('proposal_status', [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'applied',
  'failed',
]);

export const researchTaskStatusEnum = pgEnum('research_task_status', [
  'open',
  'claimed',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
]);

/**
 * The e-commerce platform a retailer runs. This is not trivia: it selects the adapter used to
 * read live price and stock. Shopify exposes `/products.json`, while BigCommerce and OpenCart
 * are read through the schema.org JSON-LD their product pages already emit for SEO — both are
 * exact, so no language model is involved in reading a price.
 */
export const vendorPlatformEnum = pgEnum('vendor_platform', [
  'shopify',
  'bigcommerce',
  'opencart',
  'woocommerce',
  'magento',
  'custom',
]);

/** How an adapter reaches a vendor, when the platform alone does not decide it. */
export const vendorFetchStrategyEnum = pgEnum('vendor_fetch_strategy', [
  /** Shopify's product JSON endpoint. */
  'shopify_json',
  /** schema.org Product/Offer JSON-LD, fetched over plain HTTP. */
  'jsonld',
  /** The same JSON-LD, but the site rejects scripted requests so a real browser renders it. */
  'browser_jsonld',
  /** Last resort: parse the rendered HTML. Fragile, so it is recorded as such. */
  'html',
]);

/** Availability, normalised across platforms that each spell it differently. */
export const stockStatusEnum = pgEnum('stock_status', [
  'in_stock',
  'out_of_stock',
  'preorder',
  'backorder',
  'discontinued',
  'unknown',
]);
