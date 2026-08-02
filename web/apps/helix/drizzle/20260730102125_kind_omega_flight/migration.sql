CREATE TABLE "apikey" (
	"id" text PRIMARY KEY,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "oauth_access_token" (
	"id" text PRIMARY KEY,
	"access_token" text NOT NULL CONSTRAINT "oauth_access_token_access_token_unique" UNIQUE,
	"refresh_token" text NOT NULL CONSTRAINT "oauth_access_token_refresh_token_unique" UNIQUE,
	"access_token_expires_at" timestamp NOT NULL,
	"refresh_token_expires_at" timestamp NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"scopes" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_application" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"icon" text,
	"metadata" text,
	"client_id" text NOT NULL CONSTRAINT "oauth_application_client_id_unique" UNIQUE,
	"client_secret" text,
	"redirect_urls" text NOT NULL,
	"type" text NOT NULL,
	"disabled" boolean DEFAULT false,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_consent" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scopes" text NOT NULL,
	"consent_given" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "apikey_reference_id_idx" ON "apikey" ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" ("key");--> statement-breakpoint
CREATE INDEX "oauth_access_token_client_id_idx" ON "oauth_access_token" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_user_id_idx" ON "oauth_access_token" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_application_user_id_idx" ON "oauth_application" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_client_id_idx" ON "oauth_consent" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_user_id_idx" ON "oauth_consent" ("user_id");--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_application_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_application"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_application" ADD CONSTRAINT "oauth_application_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_oauth_application_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_application"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;