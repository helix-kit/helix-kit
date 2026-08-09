import { jsonSchema, tool, type ToolSet } from 'ai';

import { coerceArguments } from './coerce';

import type { AiToolDescriptor } from './types';

export type ToolSetOptions = {
  /**
   * Wraps every execution. Hosts use it for the things a capability has no
   * business knowing about: auditing, timing, per-user authorization.
   */
  onCall?: (call: {
    name: string;
    /** Identifies which call this was, so a host can match it to what it is showing. */
    toolCallId: string;
    input: unknown;
    output: unknown;
    error: string | null;
    durationMs: number;
  }) => Promise<void> | void;
};

/**
 * Adapts capability tools to the shape ai-sdk runs.
 *
 * The one place in the stack that knows about a specific SDK. Capabilities
 * describe their tools without reference to a provider precisely so this seam
 * can change — or so a second runtime can exist — without touching the packages
 * that merely say what can be done.
 */
export const toToolSet = (descriptors: AiToolDescriptor[], opts: ToolSetOptions = {}): ToolSet => {
  const tools: ToolSet = {};

  for (const descriptor of descriptors) {
    tools[descriptor.name] = tool({
      description: descriptor.description,
      // Both are JSON Schema; the SDK's type is nominally its own, so the cast
      // sits at this seam rather than being forced on every capability.
      inputSchema: jsonSchema(descriptor.parameters as Parameters<typeof jsonSchema>[0]),
      execute: async (raw: unknown, options?: { toolCallId?: string }) => {
        const startedAt = Date.now();
        // Providers disagree on whether a nested object arrives as a value or as
        // a JSON string; accept both rather than making every tool handle it.
        const input = coerceArguments(descriptor.parameters, raw);
        try {
          const output = await descriptor.execute(input);
          await opts.onCall?.({
            name: descriptor.name,
            toolCallId: options?.toolCallId ?? '',
            input,
            output,
            error: null,
            durationMs: Date.now() - startedAt,
          });
          return output;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await opts.onCall?.({
            name: descriptor.name,
            toolCallId: options?.toolCallId ?? '',
            input,
            output: null,
            error: message,
            durationMs: Date.now() - startedAt,
          });
          // Returned rather than rethrown: a tool that fails is information the
          // model can act on — a bad argument it can correct, a permission it
          // must report — whereas a thrown error ends the turn and tells the
          // person nothing about what went wrong.
          return { error: message };
        }
      },
    });
  }

  return tools;
};
