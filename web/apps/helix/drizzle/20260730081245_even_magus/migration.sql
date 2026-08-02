CREATE TABLE "agent_conversation" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"messages" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_tool_call" (
	"id" text PRIMARY KEY,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"user_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_path" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_conversation_user_idx" ON "agent_conversation" ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "agent_tool_call_conversation_idx" ON "agent_tool_call" ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_tool_call_user_idx" ON "agent_tool_call" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_conversation" ADD CONSTRAINT "agent_conversation_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_tool_call" ADD CONSTRAINT "agent_tool_call_conversation_id_agent_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "agent_conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_tool_call" ADD CONSTRAINT "agent_tool_call_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;