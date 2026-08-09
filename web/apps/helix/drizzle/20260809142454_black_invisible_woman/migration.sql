ALTER TABLE "agent_tool_call" DROP CONSTRAINT "agent_tool_call_conversation_id_agent_conversation_id_fkey";--> statement-breakpoint
DROP TABLE "agent_conversation";--> statement-breakpoint
DROP TABLE "agent_tool_call";