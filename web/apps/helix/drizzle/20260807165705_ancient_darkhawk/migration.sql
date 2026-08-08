CREATE TABLE "ai_credit_grant" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"amount_usd" numeric(12,6) NOT NULL,
	"note" text,
	"granted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_event" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"reference_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12,6) DEFAULT '0' NOT NULL,
	"cost_estimated" boolean DEFAULT false NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"steps" integer DEFAULT 1 NOT NULL,
	"duration_ms" integer,
	"finish_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_user_budget" (
	"user_id" text PRIMARY KEY,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"unlimited" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
DROP TABLE "agent_usage";--> statement-breakpoint
CREATE INDEX "ai_credit_grant_user_idx" ON "ai_credit_grant" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_event_user_created_idx" ON "ai_usage_event" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_event_created_idx" ON "ai_usage_event" ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_event_feature_idx" ON "ai_usage_event" ("feature","created_at");--> statement-breakpoint
ALTER TABLE "ai_credit_grant" ADD CONSTRAINT "ai_credit_grant_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ai_usage_event_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_user_budget" ADD CONSTRAINT "ai_user_budget_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;