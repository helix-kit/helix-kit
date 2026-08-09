CREATE TABLE "conversation" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"surface" text NOT NULL,
	"subject_id" text,
	"title" text DEFAULT '' NOT NULL,
	"messages" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "conversation_tool_call" (
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
CREATE TABLE "report_template" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" text,
	"input_schema" jsonb NOT NULL,
	"code" text NOT NULL,
	"output_schema" jsonb NOT NULL,
	"spec" jsonb NOT NULL,
	"demo_input" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "conversation_owner_idx" ON "conversation" ("user_id","surface","subject_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversation_tool_call_conversation_idx" ON "conversation_tool_call" ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_tool_call_user_idx" ON "conversation_tool_call" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "report_template_updated_idx" ON "report_template" ("updated_at");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_tool_call" ADD CONSTRAINT "conversation_tool_call_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_tool_call" ADD CONSTRAINT "conversation_tool_call_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;