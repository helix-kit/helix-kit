CREATE TABLE "device_code" (
	"id" text PRIMARY KEY,
	"device_code" text NOT NULL CONSTRAINT "device_code_device_code_unique" UNIQUE,
	"user_code" text NOT NULL CONSTRAINT "device_code_user_code_unique" UNIQUE,
	"user_id" text,
	"expires_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp,
	"polling_interval" integer,
	"client_id" text,
	"scope" text
);
--> statement-breakpoint
CREATE INDEX "device_code_user_id_idx" ON "device_code" ("user_id");--> statement-breakpoint
ALTER TABLE "device_code" ADD CONSTRAINT "device_code_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;