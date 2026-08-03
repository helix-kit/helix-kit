CREATE TYPE "actor_kind" AS ENUM('human', 'agent', 'import', 'system');--> statement-breakpoint
CREATE TYPE "antenna_type" AS ENUM('pcb_trace', 'chip', 'ufl_ipex', 'sma', 'rp_sma', 'external_module', 'none', 'unknown');--> statement-breakpoint
CREATE TYPE "certification_authority" AS ENUM('fcc', 'ce', 'red', 'ukca', 'ic_ised', 'telec_mic', 'kc', 'anatel', 'bis', 'srrc', 'rcm', 'rohs', 'reach', 'weee', 'ul', 'other');--> statement-breakpoint
CREATE TYPE "claim_status" AS ENUM('proposed', 'accepted', 'disputed', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "codec_direction" AS ENUM('decode', 'encode');--> statement-breakpoint
CREATE TYPE "codec_format" AS ENUM('h264', 'h265', 'h266', 'av1', 'vp8', 'vp9', 'mpeg2', 'mpeg4', 'vc1', 'mjpeg', 'jpeg', 'webp', 'other');--> statement-breakpoint
CREATE TYPE "compatibility_level" AS ENUM('incompatible', 'unknown', 'community_reported', 'vendor_claimed', 'mechanical', 'electrical', 'pin_compatible', 'driver_compatible', 'fully_tested');--> statement-breakpoint
CREATE TYPE "composition_relation" AS ENUM('contains_module', 'carrier_for', 'bundled_with', 'requires', 'successor_of', 'variant_family_of');--> statement-breakpoint
CREATE TYPE "compute_role" AS ENUM('application', 'realtime', 'low_power', 'always_on', 'security', 'accelerator', 'graphics', 'imaging', 'media', 'io', 'other');--> statement-breakpoint
CREATE TYPE "confidence" AS ENUM('low', 'medium', 'high', 'verified');--> statement-breakpoint
CREATE TYPE "connector_kind" AS ENUM('expansion_header', 'module_socket', 'storage', 'display', 'camera', 'network', 'power', 'debug', 'audio', 'usb', 'antenna', 'other');--> statement-breakpoint
CREATE TYPE "cooling_requirement" AS ENUM('none', 'passive_heatsink', 'active_fan', 'heatsink_and_fan', 'chassis_conduction', 'unknown');--> statement-breakpoint
CREATE TYPE "core_kind" AS ENUM('cpu', 'gpu', 'npu', 'dsp', 'isp', 'video_engine', 'fpga', 'security_core', 'radio_baseband', 'other');--> statement-breakpoint
CREATE TYPE "execution_order" AS ENUM('in_order', 'out_of_order', 'unknown');--> statement-breakpoint
CREATE TYPE "form_factor_conformance" AS ENUM('exact', 'derived', 'inspired', 'claimed');--> statement-breakpoint
CREATE TYPE "interface_kind" AS ENUM('usb', 'usb_otg', 'pcie', 'ethernet', 'sata', 'sdio', 'sdmmc', 'emmc', 'qspi', 'i2c', 'i3c', 'spi', 'uart', 'can', 'canfd', 'rs232', 'rs485', 'onewire', 'i2s', 'pdm', 'pwm', 'adc', 'dac', 'gpio', 'mipi_csi', 'mipi_dsi', 'hdmi', 'displayport', 'edp', 'lvds', 'rgb_parallel', 'composite_video', 'jtag', 'swd', 'rtc', 'watchdog', 'dma', 'crypto', 'trng', 'other');--> statement-breakpoint
CREATE TYPE "isa_family" AS ENUM('arm', 'riscv', 'x86', 'xtensa', 'avr', 'mips', 'pic', 'proprietary', 'other');--> statement-breakpoint
CREATE TYPE "isa_profile" AS ENUM('application', 'realtime', 'microcontroller', 'unspecified');--> statement-breakpoint
CREATE TYPE "lifecycle_state" AS ENUM('announced', 'sampling', 'active', 'mature', 'nrnd', 'last_time_buy', 'eol', 'discontinued', 'cancelled');--> statement-breakpoint
CREATE TYPE "memory_kind" AS ENUM('sram', 'dram', 'psram', 'flash_nor', 'flash_nand', 'emmc', 'ufs', 'nvme', 'sata', 'sd_card', 'eeprom', 'fram', 'rom');--> statement-breakpoint
CREATE TYPE "memory_mounting" AS ENUM('on_die', 'in_package_sip', 'on_module', 'on_board_soldered', 'socketed', 'removable');--> statement-breakpoint
CREATE TYPE "performance_unit" AS ENUM('tops', 'gops', 'gflops', 'tflops', 'mflops');--> statement-breakpoint
CREATE TYPE "power_input_kind" AS ENUM('usb_c_pd', 'usb_c_5v', 'usb_micro', 'barrel_jack', 'terminal_block', 'header_pins', 'poe', 'poe_plus', 'molex', 'battery', 'module_connector', 'other');--> statement-breakpoint
CREATE TYPE "precision" AS ENUM('int4', 'int8', 'int16', 'int32', 'fp8', 'fp16', 'bf16', 'fp32', 'fp64', 'mixed');--> statement-breakpoint
CREATE TYPE "product_tier" AS ENUM('chip', 'module', 'som', 'board', 'carrier', 'kit', 'accessory');--> statement-breakpoint
CREATE TYPE "proposal_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected', 'applied', 'failed');--> statement-breakpoint
CREATE TYPE "radio_standard" AS ENUM('wifi', 'bluetooth', 'bluetooth_le', 'ieee_802_15_4', 'thread', 'zigbee', 'matter', 'lora', 'lorawan', 'cellular', 'nfc', 'gnss', 'uwb', 'sub_ghz', 'other');--> statement-breakpoint
CREATE TYPE "research_task_status" AS ENUM('open', 'claimed', 'in_progress', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "security_feature_kind" AS ENUM('secure_boot', 'measured_boot', 'trustzone', 'tpm', 'secure_element', 'hardware_rng', 'crypto_accelerator', 'otp_fuses', 'flash_encryption', 'memory_encryption', 'debug_lock', 'readout_protection', 'rollback_protection', 'secure_storage', 'attestation', 'unique_device_id', 'iommu', 'mpu', 'ecc_memory', 'anti_cloning', 'other');--> statement-breakpoint
CREATE TYPE "silicon_kind" AS ENUM('soc', 'mcu', 'mpu', 'wireless_soc', 'io_controller', 'fpga', 'secure_element', 'pmic', 'ethernet_phy', 'audio_codec', 'display_bridge', 'usb_controller', 'storage_controller', 'sensor', 'accelerator', 'other');--> statement-breakpoint
CREATE TYPE "silicon_role" AS ENUM('application', 'io_controller', 'radio', 'realtime_mcu', 'coprocessor', 'secure_element', 'pmic', 'ethernet_phy', 'audio_codec', 'display_bridge', 'usb_controller', 'storage_controller', 'sensor', 'accelerator', 'other');--> statement-breakpoint
CREATE TYPE "software_platform_kind" AS ENUM('linux_kernel', 'linux_distro', 'rtos', 'bare_metal_sdk', 'android', 'bootloader', 'bsp', 'toolchain', 'inference_runtime', 'container_runtime', 'other');--> statement-breakpoint
CREATE TYPE "source_type" AS ENUM('datasheet', 'reference_manual', 'schematic', 'official_product_page', 'official_documentation', 'official_repository', 'errata', 'distributor_page', 'certified_benchmark', 'lab_measurement', 'technical_review', 'community_report', 'marketplace_listing', 'other');--> statement-breakpoint
CREATE TYPE "support_level" AS ENUM('unsupported', 'broken', 'partial', 'supported', 'unknown');--> statement-breakpoint
CREATE TYPE "support_source" AS ENUM('mainline', 'vendor_kernel', 'vendor_sdk', 'third_party', 'community', 'unknown');--> statement-breakpoint
CREATE TYPE "temperature_grade" AS ENUM('commercial', 'industrial', 'extended', 'automotive', 'military', 'unspecified');--> statement-breakpoint
CREATE TABLE "change_proposal" (
	"id" text PRIMARY KEY,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" "proposal_status" DEFAULT 'draft'::"proposal_status" NOT NULL,
	"author_kind" "actor_kind" DEFAULT 'human'::"actor_kind" NOT NULL,
	"author_id" text,
	"agent_run_id" text,
	"research_task_id" text,
	"patch" jsonb NOT NULL,
	"source_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"validation_result" jsonb,
	"reviewed_by_id" text,
	"reviewed_at" timestamp,
	"review_notes" text DEFAULT '' NOT NULL,
	"applied_at" timestamp,
	"idempotency_key" text CONSTRAINT "change_proposal_idempotency_key_unique" UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim" (
	"id" text PRIMARY KEY,
	"source_id" text,
	"entity_table" text NOT NULL,
	"entity_id" text NOT NULL,
	"field_path" text DEFAULT '' NOT NULL,
	"value_text" text,
	"value_json" jsonb,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"status" "claim_status" DEFAULT 'proposed'::"claim_status" NOT NULL,
	"asserted_by_kind" "actor_kind" DEFAULT 'human'::"actor_kind" NOT NULL,
	"asserted_by_id" text,
	"quoted_text" text DEFAULT '' NOT NULL,
	"page_or_section" text DEFAULT '' NOT NULL,
	"superseded_by_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_task" (
	"id" text PRIMARY KEY,
	"subject" text NOT NULL,
	"entity_table" text,
	"entity_id" text,
	"instructions" text DEFAULT '' NOT NULL,
	"status" "research_task_status" DEFAULT 'open'::"research_task_status" NOT NULL,
	"assigned_to" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"failure_reason" text DEFAULT '' NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" text PRIMARY KEY,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL CONSTRAINT "source_canonical_url_unique" UNIQUE,
	"type" "source_type" NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"publisher" text DEFAULT '' NOT NULL,
	"published_at" timestamp,
	"retrieved_at" timestamp DEFAULT now() NOT NULL,
	"content_hash" text,
	"archive_url" text,
	"trust_rank" integer DEFAULT 100 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "architecture" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL CONSTRAINT "architecture_slug_unique" UNIQUE,
	"name" text NOT NULL,
	"family" "isa_family" NOT NULL,
	"profile" "isa_profile" DEFAULT 'unspecified'::"isa_profile" NOT NULL,
	"bits" integer,
	"base_isa" text DEFAULT '' NOT NULL,
	"extensions" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_standard" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL CONSTRAINT "connector_standard_slug_unique" UNIQUE,
	"name" text NOT NULL,
	"kind" "connector_kind" NOT NULL,
	"pin_count" integer,
	"signal_voltage_mv" integer,
	"keying" text DEFAULT '' NOT NULL,
	"spec_url" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_design" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL CONSTRAINT "core_design_slug_unique" UNIQUE,
	"name" text NOT NULL,
	"kind" "core_kind" NOT NULL,
	"architecture_id" text,
	"designer_id" text,
	"microarchitecture" text DEFAULT '' NOT NULL,
	"execution_order" "execution_order" DEFAULT 'unknown'::"execution_order" NOT NULL,
	"issue_width" integer,
	"pipeline_stages" integer,
	"l1_instruction_kb" integer,
	"l1_data_kb" integer,
	"l2_kb" integer,
	"simd_extensions" text[] DEFAULT '{}'::text[] NOT NULL,
	"has_fpu" boolean,
	"has_mmu" boolean,
	"has_mpu" boolean,
	"supports_virtualization" boolean,
	"max_clock_mhz" integer,
	"launch_year" integer,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_factor" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL CONSTRAINT "form_factor_slug_unique" UNIQUE,
	"name" text NOT NULL,
	"standard_body" text DEFAULT '' NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"width_mm" integer,
	"length_mm" integer,
	"max_height_mm" integer,
	"mounting_summary" text DEFAULT '' NOT NULL,
	"spec_url" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manufacturer" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL CONSTRAINT "manufacturer_slug_unique" UNIQUE,
	"name" text NOT NULL,
	"legal_name" text DEFAULT '' NOT NULL,
	"country_code" text DEFAULT '' NOT NULL,
	"website_url" text DEFAULT '' NOT NULL,
	"designs_silicon" boolean DEFAULT false NOT NULL,
	"designs_products" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "software_platform" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL CONSTRAINT "software_platform_slug_unique" UNIQUE,
	"name" text NOT NULL,
	"kind" "software_platform_kind" NOT NULL,
	"vendor_id" text,
	"website_url" text DEFAULT '' NOT NULL,
	"is_open_source" boolean,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silicon" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL CONSTRAINT "silicon_slug_unique" UNIQUE,
	"name" text NOT NULL,
	"kind" "silicon_kind" NOT NULL,
	"manufacturer_id" text NOT NULL,
	"part_family" text DEFAULT '' NOT NULL,
	"process_node_nm" integer,
	"process_foundry" text DEFAULT '' NOT NULL,
	"announced_at" timestamp,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"product_url" text DEFAULT '' NOT NULL,
	"datasheet_url" text DEFAULT '' NOT NULL,
	"reference_manual_url" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silicon_accelerator_performance" (
	"id" text PRIMARY KEY,
	"compute_unit_id" text NOT NULL,
	"precision" "precision" NOT NULL,
	"value" text NOT NULL,
	"unit" "performance_unit" NOT NULL,
	"conditions" text DEFAULT '' NOT NULL,
	"is_vendor_claim" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silicon_accelerator_precision" (
	"id" text PRIMARY KEY,
	"compute_unit_id" text NOT NULL,
	"precision" "precision" NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "silicon_accelerator_precision_unique" UNIQUE("compute_unit_id","precision")
);
--> statement-breakpoint
CREATE TABLE "silicon_compute_unit" (
	"id" text PRIMARY KEY,
	"silicon_id" text NOT NULL,
	"kind" "core_kind" NOT NULL,
	"role" "compute_role" NOT NULL,
	"core_design_id" text,
	"label" text DEFAULT '' NOT NULL,
	"core_count" integer DEFAULT 1 NOT NULL,
	"min_clock_mhz" integer,
	"max_clock_mhz" integer,
	"l1_instruction_kb" integer,
	"l1_data_kb" integer,
	"l2_kb" integer,
	"l3_kb" integer,
	"alternative_group" text,
	"is_default_alternative" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silicon_interface" (
	"id" text PRIMARY KEY,
	"silicon_id" text NOT NULL,
	"kind" "interface_kind" NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"lanes" integer,
	"max_speed_mbps" integer,
	"mux_notes" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silicon_isp" (
	"id" text PRIMARY KEY,
	"silicon_id" text NOT NULL,
	"generation" text DEFAULT '' NOT NULL,
	"max_sensor_mp" integer,
	"max_lanes" integer,
	"max_concurrent_sensors" integer,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silicon_media_codec" (
	"id" text PRIMARY KEY,
	"silicon_id" text NOT NULL,
	"format" "codec_format" NOT NULL,
	"direction" "codec_direction" NOT NULL,
	"profile" text DEFAULT '' NOT NULL,
	"max_width" integer,
	"max_height" integer,
	"max_fps" integer,
	"max_streams" integer,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silicon_memory_support" (
	"id" text PRIMARY KEY,
	"silicon_id" text NOT NULL,
	"kind" "memory_kind" NOT NULL,
	"standard" text DEFAULT '' NOT NULL,
	"mounting" "memory_mounting" NOT NULL,
	"capacity_mb" integer,
	"max_capacity_mb" integer,
	"channels" integer,
	"bus_width_bits" integer,
	"max_data_rate_mts" integer,
	"max_bandwidth_mbps" integer,
	"supports_ecc" boolean,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silicon_radio" (
	"id" text PRIMARY KEY,
	"silicon_id" text NOT NULL,
	"standard" "radio_standard" NOT NULL,
	"generation" text DEFAULT '' NOT NULL,
	"spec_name" text DEFAULT '' NOT NULL,
	"bands" text[] DEFAULT '{}'::text[] NOT NULL,
	"spatial_streams" integer,
	"max_phy_rate_mbps" integer,
	"protocols" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silicon_security_feature" (
	"id" text PRIMARY KEY,
	"silicon_id" text NOT NULL,
	"kind" "security_feature_kind" NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "silicon_security_feature_unique" UNIQUE("silicon_id","kind")
);
--> statement-breakpoint
CREATE TABLE "silicon_variant" (
	"id" text PRIMARY KEY,
	"silicon_id" text NOT NULL,
	"ordering_code" text NOT NULL CONSTRAINT "silicon_variant_ordering_code_unique" UNIQUE,
	"name" text DEFAULT '' NOT NULL,
	"temperature_grade" "temperature_grade" DEFAULT 'unspecified'::"temperature_grade" NOT NULL,
	"temp_min_c" integer,
	"temp_max_c" integer,
	"package_type" text DEFAULT '' NOT NULL,
	"pin_count" integer,
	"max_clock_mhz" integer,
	"on_die_flash_kb" integer,
	"on_die_ram_kb" integer,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operating_mode" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"variant_id" text,
	"name" text NOT NULL,
	"power_budget_w" text,
	"active_cpu_cores" integer,
	"cpu_clock_cap_mhz" integer,
	"gpu_clock_cap_mhz" integer,
	"accelerator_clock_cap_mhz" integer,
	"cooling_requirement" "cooling_requirement" DEFAULT 'unknown'::"cooling_requirement" NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"selection_method" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL CONSTRAINT "product_slug_unique" UNIQUE,
	"name" text NOT NULL,
	"tier" "product_tier" NOT NULL,
	"manufacturer_id" text NOT NULL,
	"family_name" text DEFAULT '' NOT NULL,
	"announced_at" timestamp,
	"released_at" timestamp,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"product_url" text DEFAULT '' NOT NULL,
	"documentation_url" text DEFAULT '' NOT NULL,
	"schematic_url" text DEFAULT '' NOT NULL,
	"open_source_hardware" boolean,
	"width_mm" text,
	"length_mm" text,
	"height_mm" text,
	"weight_g" text,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_antenna" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"variant_id" text,
	"type" "antenna_type" NOT NULL,
	"gain_dbi" text,
	"connector" text DEFAULT '' NOT NULL,
	"bands" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_included" boolean,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_certification" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"variant_id" text,
	"authority" "certification_authority" NOT NULL,
	"identifier" text DEFAULT '' NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"issued_at" timestamp,
	"expires_at" timestamp,
	"document_url" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_composition" (
	"id" text PRIMARY KEY,
	"parent_product_id" text NOT NULL,
	"child_product_id" text NOT NULL,
	"relation" "composition_relation" NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_composition_unique" UNIQUE("parent_product_id","child_product_id","relation")
);
--> statement-breakpoint
CREATE TABLE "product_connector" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"connector_standard_id" text,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"pin_count" integer,
	"signal_voltage_mv" integer,
	"position" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_environment" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"variant_id" text,
	"operating_temp_min_c" integer,
	"operating_temp_max_c" integer,
	"storage_temp_min_c" integer,
	"storage_temp_max_c" integer,
	"humidity_max_pct" integer,
	"has_conformal_coating" boolean,
	"ingress_rating" text DEFAULT '' NOT NULL,
	"shock_vibration_spec" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_exposed_interface" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"kind" "interface_kind" NOT NULL,
	"provided_by_silicon_id" text,
	"count" integer DEFAULT 1 NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"lanes" integer,
	"max_speed_mbps" integer,
	"connector_description" text DEFAULT '' NOT NULL,
	"connector_standard_id" text,
	"on_expansion_header" boolean DEFAULT false NOT NULL,
	"signal_voltage_mv" integer,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_form_factor" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"form_factor_id" text NOT NULL,
	"conformance" "form_factor_conformance" DEFAULT 'exact'::"form_factor_conformance" NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_form_factor_unique" UNIQUE("product_id","form_factor_id")
);
--> statement-breakpoint
CREATE TABLE "product_memory" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"variant_id" text,
	"kind" "memory_kind" NOT NULL,
	"standard" text DEFAULT '' NOT NULL,
	"mounting" "memory_mounting" NOT NULL,
	"capacity_mb" integer,
	"channels" integer,
	"bus_width_bits" integer,
	"data_rate_mts" integer,
	"has_ecc" boolean,
	"is_upgradable" boolean,
	"socket_type" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_power" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"input_kind" "power_input_kind" NOT NULL,
	"voltage_min_mv" integer,
	"voltage_max_mv" integer,
	"max_current_ma" integer,
	"pd_profile" text DEFAULT '' NOT NULL,
	"recommended_supply_w" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_power_draw" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"operating_mode_id" text,
	"scenario" text NOT NULL,
	"power_w" text,
	"current_ma" text,
	"is_measured" boolean DEFAULT false NOT NULL,
	"conditions" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_silicon" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"silicon_id" text NOT NULL,
	"silicon_variant_id" text,
	"role" "silicon_role" NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"interconnect" text DEFAULT '' NOT NULL,
	"clock_mhz" integer,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_storage" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"variant_id" text,
	"kind" "memory_kind" NOT NULL,
	"interface_spec" text DEFAULT '' NOT NULL,
	"capacity_mb" integer,
	"is_removable" boolean DEFAULT false NOT NULL,
	"is_bootable" boolean,
	"socket_format" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variant" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"ram_mb" integer,
	"ram_standard" text DEFAULT '' NOT NULL,
	"storage_mb" integer,
	"storage_kind" "memory_kind",
	"has_wireless" boolean,
	"antenna_type" "antenna_type",
	"region_code" text DEFAULT '' NOT NULL,
	"temperature_grade" "temperature_grade" DEFAULT 'unspecified'::"temperature_grade" NOT NULL,
	"bundled_items" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compatibility_claim" (
	"id" text PRIMARY KEY,
	"subject_product_id" text NOT NULL,
	"target_product_id" text,
	"target_form_factor_id" text,
	"target_connector_standard_id" text,
	"level" "compatibility_level" NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"caveats" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compatibility_delta" (
	"id" text PRIMARY KEY,
	"claim_id" text NOT NULL,
	"signal" text NOT NULL,
	"subject_function" text DEFAULT '' NOT NULL,
	"target_function" text DEFAULT '' NOT NULL,
	"impact" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_event" (
	"id" text PRIMARY KEY,
	"product_id" text,
	"silicon_id" text,
	"state" "lifecycle_state" NOT NULL,
	"effective_at" timestamp,
	"announced_at" timestamp,
	"summary" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "longevity_commitment" (
	"id" text PRIMARY KEY,
	"product_id" text,
	"silicon_id" text,
	"scope" text DEFAULT 'production' NOT NULL,
	"guaranteed_until" timestamp,
	"is_minimum" boolean DEFAULT true NOT NULL,
	"wording" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_revision" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"variant_id" text,
	"revision" text NOT NULL,
	"released_at" timestamp,
	"sequence" integer,
	"summary" text DEFAULT '' NOT NULL,
	"changes" text[] DEFAULT '{}'::text[] NOT NULL,
	"errata" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_revision_unique" UNIQUE("product_id","revision")
);
--> statement-breakpoint
CREATE TABLE "software_support_claim" (
	"id" text PRIMARY KEY,
	"product_id" text,
	"silicon_id" text,
	"software_platform_id" text NOT NULL,
	"component" text NOT NULL,
	"level" "support_level" NOT NULL,
	"source" "support_source" DEFAULT 'unknown'::"support_source" NOT NULL,
	"version_introduced" text DEFAULT '' NOT NULL,
	"version_tested" text DEFAULT '' NOT NULL,
	"requires_blob" boolean,
	"toolchain" text DEFAULT '' NOT NULL,
	"last_verified_at" timestamp,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "change_proposal_status_idx" ON "change_proposal" ("status");--> statement-breakpoint
CREATE INDEX "change_proposal_agent_run_idx" ON "change_proposal" ("agent_run_id");--> statement-breakpoint
CREATE INDEX "claim_entity_idx" ON "claim" ("entity_table","entity_id");--> statement-breakpoint
CREATE INDEX "claim_field_idx" ON "claim" ("entity_table","entity_id","field_path");--> statement-breakpoint
CREATE INDEX "claim_status_idx" ON "claim" ("status");--> statement-breakpoint
CREATE INDEX "claim_source_idx" ON "claim" ("source_id");--> statement-breakpoint
CREATE INDEX "research_task_status_idx" ON "research_task" ("status");--> statement-breakpoint
CREATE INDEX "research_task_entity_idx" ON "research_task" ("entity_table","entity_id");--> statement-breakpoint
CREATE INDEX "source_type_idx" ON "source" ("type");--> statement-breakpoint
CREATE INDEX "architecture_family_idx" ON "architecture" ("family");--> statement-breakpoint
CREATE INDEX "connector_standard_kind_idx" ON "connector_standard" ("kind");--> statement-breakpoint
CREATE INDEX "core_design_kind_idx" ON "core_design" ("kind");--> statement-breakpoint
CREATE INDEX "core_design_architecture_idx" ON "core_design" ("architecture_id");--> statement-breakpoint
CREATE INDEX "software_platform_kind_idx" ON "software_platform" ("kind");--> statement-breakpoint
CREATE INDEX "silicon_kind_idx" ON "silicon" ("kind");--> statement-breakpoint
CREATE INDEX "silicon_manufacturer_idx" ON "silicon" ("manufacturer_id");--> statement-breakpoint
CREATE INDEX "silicon_part_family_idx" ON "silicon" ("part_family");--> statement-breakpoint
CREATE INDEX "silicon_accelerator_performance_unit_idx" ON "silicon_accelerator_performance" ("compute_unit_id");--> statement-breakpoint
CREATE INDEX "silicon_accelerator_performance_precision_idx" ON "silicon_accelerator_performance" ("precision");--> statement-breakpoint
CREATE INDEX "silicon_compute_unit_silicon_idx" ON "silicon_compute_unit" ("silicon_id");--> statement-breakpoint
CREATE INDEX "silicon_compute_unit_core_design_idx" ON "silicon_compute_unit" ("core_design_id");--> statement-breakpoint
CREATE INDEX "silicon_compute_unit_kind_idx" ON "silicon_compute_unit" ("kind");--> statement-breakpoint
CREATE INDEX "silicon_compute_unit_alternative_idx" ON "silicon_compute_unit" ("silicon_id","alternative_group");--> statement-breakpoint
CREATE INDEX "silicon_interface_silicon_idx" ON "silicon_interface" ("silicon_id");--> statement-breakpoint
CREATE INDEX "silicon_interface_kind_idx" ON "silicon_interface" ("kind");--> statement-breakpoint
CREATE INDEX "silicon_isp_silicon_idx" ON "silicon_isp" ("silicon_id");--> statement-breakpoint
CREATE INDEX "silicon_media_codec_silicon_idx" ON "silicon_media_codec" ("silicon_id");--> statement-breakpoint
CREATE INDEX "silicon_media_codec_format_idx" ON "silicon_media_codec" ("format","direction");--> statement-breakpoint
CREATE INDEX "silicon_memory_support_silicon_idx" ON "silicon_memory_support" ("silicon_id");--> statement-breakpoint
CREATE INDEX "silicon_memory_support_kind_idx" ON "silicon_memory_support" ("kind");--> statement-breakpoint
CREATE INDEX "silicon_radio_silicon_idx" ON "silicon_radio" ("silicon_id");--> statement-breakpoint
CREATE INDEX "silicon_radio_standard_idx" ON "silicon_radio" ("standard");--> statement-breakpoint
CREATE INDEX "silicon_security_feature_kind_idx" ON "silicon_security_feature" ("kind");--> statement-breakpoint
CREATE INDEX "silicon_variant_silicon_idx" ON "silicon_variant" ("silicon_id");--> statement-breakpoint
CREATE INDEX "silicon_variant_temperature_grade_idx" ON "silicon_variant" ("temperature_grade");--> statement-breakpoint
CREATE INDEX "operating_mode_product_idx" ON "operating_mode" ("product_id");--> statement-breakpoint
CREATE INDEX "operating_mode_variant_idx" ON "operating_mode" ("variant_id");--> statement-breakpoint
CREATE INDEX "product_tier_idx" ON "product" ("tier");--> statement-breakpoint
CREATE INDEX "product_manufacturer_idx" ON "product" ("manufacturer_id");--> statement-breakpoint
CREATE INDEX "product_family_idx" ON "product" ("family_name");--> statement-breakpoint
CREATE INDEX "product_antenna_product_idx" ON "product_antenna" ("product_id");--> statement-breakpoint
CREATE INDEX "product_certification_product_idx" ON "product_certification" ("product_id");--> statement-breakpoint
CREATE INDEX "product_certification_authority_idx" ON "product_certification" ("authority");--> statement-breakpoint
CREATE INDEX "product_composition_parent_idx" ON "product_composition" ("parent_product_id");--> statement-breakpoint
CREATE INDEX "product_composition_child_idx" ON "product_composition" ("child_product_id");--> statement-breakpoint
CREATE INDEX "product_connector_product_idx" ON "product_connector" ("product_id");--> statement-breakpoint
CREATE INDEX "product_environment_product_idx" ON "product_environment" ("product_id");--> statement-breakpoint
CREATE INDEX "product_exposed_interface_product_idx" ON "product_exposed_interface" ("product_id");--> statement-breakpoint
CREATE INDEX "product_exposed_interface_kind_idx" ON "product_exposed_interface" ("kind");--> statement-breakpoint
CREATE INDEX "product_exposed_interface_silicon_idx" ON "product_exposed_interface" ("provided_by_silicon_id");--> statement-breakpoint
CREATE INDEX "product_form_factor_form_factor_idx" ON "product_form_factor" ("form_factor_id");--> statement-breakpoint
CREATE INDEX "product_memory_product_idx" ON "product_memory" ("product_id");--> statement-breakpoint
CREATE INDEX "product_memory_variant_idx" ON "product_memory" ("variant_id");--> statement-breakpoint
CREATE INDEX "product_power_product_idx" ON "product_power" ("product_id");--> statement-breakpoint
CREATE INDEX "product_power_draw_product_idx" ON "product_power_draw" ("product_id");--> statement-breakpoint
CREATE INDEX "product_power_draw_mode_idx" ON "product_power_draw" ("operating_mode_id");--> statement-breakpoint
CREATE INDEX "product_silicon_product_idx" ON "product_silicon" ("product_id");--> statement-breakpoint
CREATE INDEX "product_silicon_silicon_idx" ON "product_silicon" ("silicon_id");--> statement-breakpoint
CREATE INDEX "product_silicon_role_idx" ON "product_silicon" ("role");--> statement-breakpoint
CREATE INDEX "product_storage_product_idx" ON "product_storage" ("product_id");--> statement-breakpoint
CREATE INDEX "product_storage_variant_idx" ON "product_storage" ("variant_id");--> statement-breakpoint
CREATE INDEX "product_variant_product_idx" ON "product_variant" ("product_id");--> statement-breakpoint
CREATE INDEX "product_variant_sku_idx" ON "product_variant" ("sku");--> statement-breakpoint
CREATE INDEX "compatibility_claim_subject_idx" ON "compatibility_claim" ("subject_product_id");--> statement-breakpoint
CREATE INDEX "compatibility_claim_target_product_idx" ON "compatibility_claim" ("target_product_id");--> statement-breakpoint
CREATE INDEX "compatibility_claim_level_idx" ON "compatibility_claim" ("level");--> statement-breakpoint
CREATE INDEX "compatibility_delta_claim_idx" ON "compatibility_delta" ("claim_id");--> statement-breakpoint
CREATE INDEX "lifecycle_event_product_idx" ON "lifecycle_event" ("product_id");--> statement-breakpoint
CREATE INDEX "lifecycle_event_silicon_idx" ON "lifecycle_event" ("silicon_id");--> statement-breakpoint
CREATE INDEX "lifecycle_event_state_idx" ON "lifecycle_event" ("state");--> statement-breakpoint
CREATE INDEX "longevity_commitment_product_idx" ON "longevity_commitment" ("product_id");--> statement-breakpoint
CREATE INDEX "longevity_commitment_silicon_idx" ON "longevity_commitment" ("silicon_id");--> statement-breakpoint
CREATE INDEX "product_revision_product_idx" ON "product_revision" ("product_id");--> statement-breakpoint
CREATE INDEX "software_support_claim_product_idx" ON "software_support_claim" ("product_id");--> statement-breakpoint
CREATE INDEX "software_support_claim_silicon_idx" ON "software_support_claim" ("silicon_id");--> statement-breakpoint
CREATE INDEX "software_support_claim_platform_idx" ON "software_support_claim" ("software_platform_id");--> statement-breakpoint
CREATE INDEX "software_support_claim_level_idx" ON "software_support_claim" ("level");--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "architecture" ADD CONSTRAINT "architecture_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "connector_standard" ADD CONSTRAINT "connector_standard_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "core_design" ADD CONSTRAINT "core_design_architecture_id_architecture_id_fkey" FOREIGN KEY ("architecture_id") REFERENCES "architecture"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "core_design" ADD CONSTRAINT "core_design_designer_id_manufacturer_id_fkey" FOREIGN KEY ("designer_id") REFERENCES "manufacturer"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "core_design" ADD CONSTRAINT "core_design_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "form_factor" ADD CONSTRAINT "form_factor_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "manufacturer" ADD CONSTRAINT "manufacturer_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "software_platform" ADD CONSTRAINT "software_platform_vendor_id_manufacturer_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "manufacturer"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "software_platform" ADD CONSTRAINT "software_platform_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "silicon" ADD CONSTRAINT "silicon_manufacturer_id_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "manufacturer"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "silicon" ADD CONSTRAINT "silicon_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "silicon_accelerator_performance" ADD CONSTRAINT "silicon_accelerator_performance_pbqi3ovoCGuC_fkey" FOREIGN KEY ("compute_unit_id") REFERENCES "silicon_compute_unit"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "silicon_accelerator_performance" ADD CONSTRAINT "silicon_accelerator_performance_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "silicon_accelerator_precision" ADD CONSTRAINT "silicon_accelerator_precision_AqIx5GouX6vq_fkey" FOREIGN KEY ("compute_unit_id") REFERENCES "silicon_compute_unit"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "silicon_accelerator_precision" ADD CONSTRAINT "silicon_accelerator_precision_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "silicon_compute_unit" ADD CONSTRAINT "silicon_compute_unit_silicon_id_silicon_id_fkey" FOREIGN KEY ("silicon_id") REFERENCES "silicon"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "silicon_compute_unit" ADD CONSTRAINT "silicon_compute_unit_core_design_id_core_design_id_fkey" FOREIGN KEY ("core_design_id") REFERENCES "core_design"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "silicon_compute_unit" ADD CONSTRAINT "silicon_compute_unit_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "silicon_interface" ADD CONSTRAINT "silicon_interface_silicon_id_silicon_id_fkey" FOREIGN KEY ("silicon_id") REFERENCES "silicon"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "silicon_interface" ADD CONSTRAINT "silicon_interface_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "silicon_isp" ADD CONSTRAINT "silicon_isp_silicon_id_silicon_id_fkey" FOREIGN KEY ("silicon_id") REFERENCES "silicon"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "silicon_isp" ADD CONSTRAINT "silicon_isp_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "silicon_media_codec" ADD CONSTRAINT "silicon_media_codec_silicon_id_silicon_id_fkey" FOREIGN KEY ("silicon_id") REFERENCES "silicon"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "silicon_media_codec" ADD CONSTRAINT "silicon_media_codec_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "silicon_memory_support" ADD CONSTRAINT "silicon_memory_support_silicon_id_silicon_id_fkey" FOREIGN KEY ("silicon_id") REFERENCES "silicon"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "silicon_memory_support" ADD CONSTRAINT "silicon_memory_support_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "silicon_radio" ADD CONSTRAINT "silicon_radio_silicon_id_silicon_id_fkey" FOREIGN KEY ("silicon_id") REFERENCES "silicon"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "silicon_radio" ADD CONSTRAINT "silicon_radio_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "silicon_security_feature" ADD CONSTRAINT "silicon_security_feature_silicon_id_silicon_id_fkey" FOREIGN KEY ("silicon_id") REFERENCES "silicon"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "silicon_security_feature" ADD CONSTRAINT "silicon_security_feature_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "silicon_variant" ADD CONSTRAINT "silicon_variant_silicon_id_silicon_id_fkey" FOREIGN KEY ("silicon_id") REFERENCES "silicon"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "silicon_variant" ADD CONSTRAINT "silicon_variant_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "operating_mode" ADD CONSTRAINT "operating_mode_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "operating_mode" ADD CONSTRAINT "operating_mode_variant_id_product_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "operating_mode" ADD CONSTRAINT "operating_mode_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_manufacturer_id_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "manufacturer"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_antenna" ADD CONSTRAINT "product_antenna_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_antenna" ADD CONSTRAINT "product_antenna_variant_id_product_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_antenna" ADD CONSTRAINT "product_antenna_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_certification" ADD CONSTRAINT "product_certification_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_certification" ADD CONSTRAINT "product_certification_variant_id_product_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_certification" ADD CONSTRAINT "product_certification_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_composition" ADD CONSTRAINT "product_composition_parent_product_id_product_id_fkey" FOREIGN KEY ("parent_product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_composition" ADD CONSTRAINT "product_composition_child_product_id_product_id_fkey" FOREIGN KEY ("child_product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_composition" ADD CONSTRAINT "product_composition_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_connector" ADD CONSTRAINT "product_connector_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_connector" ADD CONSTRAINT "product_connector_TcJcNura2D2d_fkey" FOREIGN KEY ("connector_standard_id") REFERENCES "connector_standard"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_connector" ADD CONSTRAINT "product_connector_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_environment" ADD CONSTRAINT "product_environment_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_environment" ADD CONSTRAINT "product_environment_variant_id_product_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_environment" ADD CONSTRAINT "product_environment_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_exposed_interface" ADD CONSTRAINT "product_exposed_interface_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_exposed_interface" ADD CONSTRAINT "product_exposed_interface_ZQq6MX9qe8mk_fkey" FOREIGN KEY ("provided_by_silicon_id") REFERENCES "silicon"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_exposed_interface" ADD CONSTRAINT "product_exposed_interface_3qhrCgk6WdI6_fkey" FOREIGN KEY ("connector_standard_id") REFERENCES "connector_standard"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_exposed_interface" ADD CONSTRAINT "product_exposed_interface_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_form_factor" ADD CONSTRAINT "product_form_factor_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_form_factor" ADD CONSTRAINT "product_form_factor_form_factor_id_form_factor_id_fkey" FOREIGN KEY ("form_factor_id") REFERENCES "form_factor"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_form_factor" ADD CONSTRAINT "product_form_factor_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_memory" ADD CONSTRAINT "product_memory_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_memory" ADD CONSTRAINT "product_memory_variant_id_product_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_memory" ADD CONSTRAINT "product_memory_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_power" ADD CONSTRAINT "product_power_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_power" ADD CONSTRAINT "product_power_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_power_draw" ADD CONSTRAINT "product_power_draw_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_power_draw" ADD CONSTRAINT "product_power_draw_operating_mode_id_operating_mode_id_fkey" FOREIGN KEY ("operating_mode_id") REFERENCES "operating_mode"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_power_draw" ADD CONSTRAINT "product_power_draw_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_silicon" ADD CONSTRAINT "product_silicon_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_silicon" ADD CONSTRAINT "product_silicon_silicon_id_silicon_id_fkey" FOREIGN KEY ("silicon_id") REFERENCES "silicon"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "product_silicon" ADD CONSTRAINT "product_silicon_silicon_variant_id_silicon_variant_id_fkey" FOREIGN KEY ("silicon_variant_id") REFERENCES "silicon_variant"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_silicon" ADD CONSTRAINT "product_silicon_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_storage" ADD CONSTRAINT "product_storage_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_storage" ADD CONSTRAINT "product_storage_variant_id_product_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_storage" ADD CONSTRAINT "product_storage_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "compatibility_claim" ADD CONSTRAINT "compatibility_claim_subject_product_id_product_id_fkey" FOREIGN KEY ("subject_product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "compatibility_claim" ADD CONSTRAINT "compatibility_claim_target_product_id_product_id_fkey" FOREIGN KEY ("target_product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "compatibility_claim" ADD CONSTRAINT "compatibility_claim_target_form_factor_id_form_factor_id_fkey" FOREIGN KEY ("target_form_factor_id") REFERENCES "form_factor"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "compatibility_claim" ADD CONSTRAINT "compatibility_claim_dTHUKYN8U6O7_fkey" FOREIGN KEY ("target_connector_standard_id") REFERENCES "connector_standard"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "compatibility_claim" ADD CONSTRAINT "compatibility_claim_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "compatibility_delta" ADD CONSTRAINT "compatibility_delta_claim_id_compatibility_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "compatibility_claim"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "compatibility_delta" ADD CONSTRAINT "compatibility_delta_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "lifecycle_event" ADD CONSTRAINT "lifecycle_event_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "lifecycle_event" ADD CONSTRAINT "lifecycle_event_silicon_id_silicon_id_fkey" FOREIGN KEY ("silicon_id") REFERENCES "silicon"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "lifecycle_event" ADD CONSTRAINT "lifecycle_event_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "longevity_commitment" ADD CONSTRAINT "longevity_commitment_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "longevity_commitment" ADD CONSTRAINT "longevity_commitment_silicon_id_silicon_id_fkey" FOREIGN KEY ("silicon_id") REFERENCES "silicon"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "longevity_commitment" ADD CONSTRAINT "longevity_commitment_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_revision" ADD CONSTRAINT "product_revision_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_revision" ADD CONSTRAINT "product_revision_variant_id_product_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_revision" ADD CONSTRAINT "product_revision_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "software_support_claim" ADD CONSTRAINT "software_support_claim_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "software_support_claim" ADD CONSTRAINT "software_support_claim_silicon_id_silicon_id_fkey" FOREIGN KEY ("silicon_id") REFERENCES "silicon"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "software_support_claim" ADD CONSTRAINT "software_support_claim_kQiyeMo5AX58_fkey" FOREIGN KEY ("software_platform_id") REFERENCES "software_platform"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "software_support_claim" ADD CONSTRAINT "software_support_claim_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;