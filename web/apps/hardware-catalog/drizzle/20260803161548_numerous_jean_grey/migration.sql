CREATE TYPE "stock_status" AS ENUM('in_stock', 'out_of_stock', 'preorder', 'backorder', 'discontinued', 'unknown');--> statement-breakpoint
CREATE TYPE "vendor_fetch_strategy" AS ENUM('shopify_json', 'jsonld', 'browser_jsonld', 'html');--> statement-breakpoint
CREATE TYPE "vendor_platform" AS ENUM('shopify', 'bigcommerce', 'opencart', 'woocommerce', 'magento', 'custom');--> statement-breakpoint
CREATE TABLE "vendor" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL CONSTRAINT "vendor_slug_unique" UNIQUE,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"country_code" text DEFAULT 'IN' NOT NULL,
	"currency_code" text DEFAULT 'INR' NOT NULL,
	"platform" "vendor_platform" NOT NULL,
	"fetch_strategy" "vendor_fetch_strategy" NOT NULL,
	"price_selector" text DEFAULT '' NOT NULL,
	"stock_selector" text DEFAULT '' NOT NULL,
	"publishes_stock_count" boolean DEFAULT false NOT NULL,
	"sitemap_url" text DEFAULT '' NOT NULL,
	"requires_browser" boolean DEFAULT false NOT NULL,
	"requests_per_second" integer DEFAULT 1 NOT NULL,
	"prices_include_tax" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_offer" (
	"id" text PRIMARY KEY,
	"vendor_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text,
	"url" text NOT NULL,
	"vendor_sku" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"currency_code" text DEFAULT 'INR' NOT NULL,
	"amount_minor" integer,
	"list_amount_minor" integer,
	"stock_status" "stock_status" DEFAULT 'unknown'::"stock_status" NOT NULL,
	"stock_quantity" integer,
	"in_stock" boolean,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_error_at" timestamp,
	"last_error" text DEFAULT '' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_offer_scope_unique" UNIQUE("vendor_id","product_id","variant_id"),
	CONSTRAINT "vendor_offer_url_unique" UNIQUE("vendor_id","url")
);
--> statement-breakpoint
CREATE TABLE "vendor_offer_snapshot" (
	"id" text PRIMARY KEY,
	"offer_id" text NOT NULL,
	"amount_minor" integer,
	"list_amount_minor" integer,
	"stock_status" "stock_status" DEFAULT 'unknown'::"stock_status" NOT NULL,
	"stock_quantity" integer,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "vendor_country_idx" ON "vendor" ("country_code");--> statement-breakpoint
CREATE INDEX "vendor_offer_product_idx" ON "vendor_offer" ("product_id");--> statement-breakpoint
CREATE INDEX "vendor_offer_vendor_idx" ON "vendor_offer" ("vendor_id");--> statement-breakpoint
CREATE INDEX "vendor_offer_stock_idx" ON "vendor_offer" ("stock_status");--> statement-breakpoint
CREATE INDEX "vendor_offer_snapshot_offer_idx" ON "vendor_offer_snapshot" ("offer_id","observed_at");--> statement-breakpoint
ALTER TABLE "vendor_offer" ADD CONSTRAINT "vendor_offer_vendor_id_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendor_offer" ADD CONSTRAINT "vendor_offer_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendor_offer" ADD CONSTRAINT "vendor_offer_variant_id_product_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendor_offer" ADD CONSTRAINT "vendor_offer_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "vendor_offer_snapshot" ADD CONSTRAINT "vendor_offer_snapshot_offer_id_vendor_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "vendor_offer"("id") ON DELETE CASCADE;