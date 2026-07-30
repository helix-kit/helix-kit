import { collectProcedureTools, recordToolCall } from '@helix/backend/agent';
import { jsonSchema, tool, type ToolSet } from 'ai';

import { appRouter } from '@/server/trpc';

import type { DatabaseClient } from '@helix/backend/db';

type BuildAgentToolsOptions = {
  db: DatabaseClient;
  /** The tRPC caller bound to the requesting user's context (enforces per-procedure authz). */
  caller: unknown;
  conversationId: string;
  userId: string;
};

/**
 * Wrap every exposed tRPC procedure into an ai-sdk tool. Execution goes through
 * the user's caller (so each procedure's own authorization runs) and every call —
 * success or failure — is written to the `agent_tool_call` audit table. Because
 * the whole surface is exposed, including destructive mutations, that audit trail
 * is the record of what the agent did on the user's behalf.
 */
export const buildAgentTools = ({
  db,
  caller,
  conversationId,
  userId,
}: BuildAgentToolsOptions): ToolSet => {
  const descriptors = collectProcedureTools(appRouter, caller);
  const tools: ToolSet = {};

  for (const descriptor of descriptors) {
    tools[descriptor.name] = tool({
      description: descriptor.description,
      inputSchema: jsonSchema(descriptor.inputJsonSchema),
      execute: async (input: unknown) => {
        const startedAt = Date.now();
        try {
          const output = await descriptor.execute(input);
          await recordToolCall(db, {
            conversationId,
            userId,
            messageId: null,
            toolName: descriptor.name,
            toolPath: descriptor.path,
            input,
            output,
            error: null,
            durationMs: Date.now() - startedAt,
          });
          return output;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await recordToolCall(db, {
            conversationId,
            userId,
            messageId: null,
            toolName: descriptor.name,
            toolPath: descriptor.path,
            input,
            output: null,
            error: message,
            durationMs: Date.now() - startedAt,
          });
          throw error;
        }
      },
    });
  }

  return tools;
};
