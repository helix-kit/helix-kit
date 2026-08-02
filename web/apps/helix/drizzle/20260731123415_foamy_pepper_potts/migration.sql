CREATE TABLE "agent_usage" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"conversation_id" text,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer,
	"cached_input_tokens" integer,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"steps" integer DEFAULT 1 NOT NULL,
	"duration_ms" integer,
	"finish_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_usage_user_idx" ON "agent_usage" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_usage_created_idx" ON "agent_usage" ("created_at");--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;