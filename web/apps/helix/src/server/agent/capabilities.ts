import { collectProcedureTools, type ProcedureDescriptor } from '@helix-hq/backend/agent';
import { recordToolCall } from '@helix-hq/backend/conversations';
import { codeExecutorTool } from '@helix-hq/code-executor/ai';

import { appRouter } from '@/server/trpc';

import type { AiCapability, AiToolDescriptor } from '@helix-hq/ai-kit';
import type { DatabaseClient } from '@helix-hq/backend/db';
import type { HostFunctions } from '@helix-hq/code-executor';

/** Procedures the sandbox may call. Read-only: code runs without confirmation. */
const sandboxable = (descriptor: ProcedureDescriptor): boolean => descriptor.readOnly;

const PLATFORM = `Helix manages devices, firmware releases and OTA, device profiles, users, PKI and certificates, and a blog.

Every tool runs with this user's own permissions. Attempt the action and report the authorization error a forbidden call returns, rather than guessing at what is allowed.

- Read data before acting on it; prefer a tool over an assumption.
- Confirm before changing or deleting anything, unless the request was explicit.
- Summarise results in plain language. Do not dump raw JSON unless asked.`;

/**
 * The platform API, as tools.
 *
 * Derived from the router rather than a maintained list, so a procedure added to
 * Helix is reachable by the assistant the moment it exists.
 */
const platformCapability = ({
  db,
  caller,
  conversationId,
  userId,
}: {
  db: DatabaseClient;
  caller: unknown;
  conversationId: string;
  userId: string;
}): AiCapability => {
  const descriptors = collectProcedureTools(appRouter, caller);

  const tools: AiToolDescriptor[] = descriptors.map((descriptor) => ({
    name: descriptor.name,
    description: descriptor.description,
    parameters: descriptor.inputJsonSchema,
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
  }));

  return {
    id: 'platform',
    sections: [{ id: 'platform.overview', title: 'The Helix platform', body: PLATFORM }],
    tools,
    artifacts: [],
  };
};

/**
 * The read-only slice of the platform, as functions the sandbox can call.
 *
 * The same procedures, reached a second way. Answering "which profiles have a
 * device that has not reported in a week" through tools alone is a list call
 * followed by one call per device and arithmetic done in prose; in the sandbox it
 * is a loop. Only read-only procedures are lent, because sandboxed code runs
 * without the confirmation step a mutation deserves.
 */
const sandboxFunctions = (caller: unknown): HostFunctions => {
  const functions: HostFunctions = {};

  for (const descriptor of collectProcedureTools(appRouter, caller).filter(sandboxable)) {
    functions[descriptor.name] = {
      handler: async (argument: unknown) => descriptor.execute(argument ?? {}),
      description: descriptor.description,
      parameters: descriptor.inputJsonSchema,
    };
  }

  return functions;
};

/** The assistant's capability set: the API as tools, and the API from code. */
export const assistantCapabilities = (options: {
  db: DatabaseClient;
  caller: unknown;
  conversationId: string;
  userId: string;
}): AiCapability[] => [
  platformCapability(options),
  codeExecutorTool({
    id: 'query',
    functions: sandboxFunctions(options.caller),
    guidance:
      'These are the same read-only procedures offered as tools. Call one directly for a single lookup; run code when the answer needs several lookups combined, filtered or counted.',
  }),
];
