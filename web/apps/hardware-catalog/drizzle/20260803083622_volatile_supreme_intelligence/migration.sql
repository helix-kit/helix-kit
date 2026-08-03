CREATE TYPE "product_image_kind" AS ENUM('photo', 'render', 'board_layout', 'pinout', 'block_diagram', 'dimensions', 'packaging', 'detail');--> statement-breakpoint
CREATE TYPE "product_link_kind" AS ENUM('official_product', 'documentation', 'datasheet', 'schematic', 'wiki', 'source_repository', 'os_image', 'driver_download', 'cad_model', 'certification', 'store', 'distributor', 'forum', 'review', 'video', 'other');--> statement-breakpoint
CREATE TABLE "product_image" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"variant_id" text,
	"kind" "product_image_kind" DEFAULT 'photo'::"product_image_kind" NOT NULL,
	"url" text NOT NULL,
	"storage_key" text,
	"content_type" text DEFAULT '' NOT NULL,
	"byte_size" integer,
	"width" integer,
	"height" integer,
	"alt" text DEFAULT '' NOT NULL,
	"credit" text DEFAULT '' NOT NULL,
	"licence" text DEFAULT '' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_image_url_unique" UNIQUE("product_id","url")
);
--> statement-breakpoint
CREATE TABLE "product_link" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"variant_id" text,
	"kind" "product_link_kind" NOT NULL,
	"url" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"region_code" text DEFAULT '' NOT NULL,
	"language_code" text DEFAULT '' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp,
	"is_broken" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_link_url_unique" UNIQUE("product_id","url")
);
--> statement-breakpoint
CREATE INDEX "product_image_product_idx" ON "product_image" ("product_id");--> statement-breakpoint
CREATE INDEX "product_image_primary_idx" ON "product_image" ("product_id","is_primary");--> statement-breakpoint
CREATE INDEX "product_link_product_idx" ON "product_link" ("product_id");--> statement-breakpoint
CREATE INDEX "product_link_kind_idx" ON "product_link" ("kind");--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_variant_id_product_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_link" ADD CONSTRAINT "product_link_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_link" ADD CONSTRAINT "product_link_variant_id_product_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_link" ADD CONSTRAINT "product_link_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;