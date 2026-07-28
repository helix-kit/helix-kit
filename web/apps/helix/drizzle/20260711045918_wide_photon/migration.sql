CREATE TABLE "device_certificate" (
	"id" text PRIMARY KEY,
	"device_id" text NOT NULL,
	"serial_number" text NOT NULL CONSTRAINT "device_certificate_serial_number_unique" UNIQUE,
	"fingerprint_sha256" text NOT NULL,
	"subject_common_name" text,
	"not_before" timestamp NOT NULL,
	"not_after" timestamp NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp,
	"revocation_reason" text,
	"revoked_by_user_id" text
);
--> statement-breakpoint
CREATE INDEX "device_certificate_device_id_idx" ON "device_certificate" ("device_id");--> statement-breakpoint
ALTER TABLE "device_certificate" ADD CONSTRAINT "device_certificate_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE;