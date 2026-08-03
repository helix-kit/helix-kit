CREATE TYPE "price_kind" AS ENUM('estimated', 'msrp', 'street', 'promotional', 'observed_offer');--> statement-breakpoint
CREATE TABLE "price_estimate" (
	"id" text PRIMARY KEY,
	"product_id" text NOT NULL,
	"variant_id" text,
	"country_code" text NOT NULL,
	"currency_code" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"kind" "price_kind" DEFAULT 'estimated'::"price_kind" NOT NULL,
	"includes_tax" boolean,
	"includes_shipping" boolean,
	"as_of" timestamp DEFAULT now() NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_id" text,
	"confidence" "confidence" DEFAULT 'medium'::"confidence" NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "price_estimate_scope_unique" UNIQUE("product_id","variant_id","country_code")
);
--> statement-breakpoint
CREATE INDEX "price_estimate_product_idx" ON "price_estimate" ("product_id");--> statement-breakpoint
CREATE INDEX "price_estimate_country_idx" ON "price_estimate" ("country_code");--> statement-breakpoint
ALTER TABLE "price_estimate" ADD CONSTRAINT "price_estimate_product_id_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "price_estimate" ADD CONSTRAINT "price_estimate_variant_id_product_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "price_estimate" ADD CONSTRAINT "price_estimate_source_id_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL;