import { describeEnvironment } from './declarations';
import { executeCode } from './execute';
import { DEFAULT_LIMITS } from './limits';

import type { ExecutionLimits, HostFunctions } from './types';
import type { AiCapability, AiToolDescriptor, PromptSection } from '@helix-hq/ai-kit';
import type { JSONSchema } from 'zod/v4/core';

const GUEST_CONTRACT = `Code is the **body of a function**. \`return\` produces the result; there is no \`module.exports\`, no \`export default\` and no \`main()\`.

- TypeScript is compiled before it runs, so annotations are fine. Types are erased, not checked.
- \`console.log\` records values and is the only way to explain what the code saw.
- Host functions block and return their value directly. Do **not** \`await\` them and do not write an \`async\` function — the sandbox has no event loop, so a promise never settles.
- There is no network, no filesystem, no timers, and no access to anything the host did not hand over.`;

const BYTES_PER_MB = 1_048_576;

const describeLimits = (limits: ExecutionLimits): string => {
  const resolved = { ...DEFAULT_LIMITS, ...limits };
  return `A run is capped: ${resolved.cpuMs}ms of execution, ${resolved.wallClockMs}ms overall, ${Math.round(resolved.memoryBytes / BYTES_PER_MB)}MB of memory, ${resolved.maxCalls} host calls and ${resolved.maxLogs} log lines. Exceeding any of them fails the run, so prefer a single pass over the data to repeated scans.`;
};

const TRY_RESULT_SCHEMA: JSONSchema.JSONSchema = {
  type: 'object',
  properties: {
    code: { type: 'string', description: 'The code to run — a function body.' },
    input: {
      anyOf: [
        { type: 'object' },
        { type: 'array' },
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
      ],
      description: 'Input to run against. Omit to use the sample input.',
    },
  },
  required: ['code'],
  additionalProperties: false,
};

export type CodeEnvironment = {
  inputSchema?: JSONSchema._JSONSchema;
  outputSchema?: JSONSchema._JSONSchema;
  /** Input the try-it tool uses when the model does not supply one. */
  sampleInput?: unknown;
};

export type CodeAuthoringOptions = CodeEnvironment & {
  functions?: HostFunctions;
  limits?: ExecutionLimits;
  /** Distinguishes ids and the tool name when two executors are composed. */
  id?: string;
  /**
   * Reads the environment as it stands when the tool runs, rather than as it was
   * when the capability was built.
   *
   * Necessary wherever the model can change the environment mid-turn: having
   * rewritten the input schema, it would otherwise have its code checked against
   * the schema it replaced, and be told its correct code is wrong.
   */
  resolve?: () => CodeEnvironment;
};

/**
 * The executor as something a model **writes code for**.
 *
 * Contributes what the guest contract is, what the environment provides, and a
 * tool that actually runs a candidate. The tool is the point: a model asked to
 * write sandboxed code guesses at conventions it cannot see, and running the
 * result against real input turns that guess into an error it can read and fix
 * within the same turn.
 */
export const codeExecutorAuthoring = (options: CodeAuthoringOptions = {}): AiCapability => {
  const {
    id = 'code',
    inputSchema,
    outputSchema,
    functions,
    sampleInput,
    limits = {},
    resolve,
  } = options;

  const sections: PromptSection[] = [
    { id: `${id}.contract`, title: 'Writing the code', body: GUEST_CONTRACT },
    {
      id: `${id}.environment`,
      title: 'What the code can reach',
      body: `These declarations are exact — the sandbox binds precisely this and nothing else:\n\n\`\`\`ts\n${describeEnvironment({ inputSchema, functions })}\n\`\`\``,
    },
    { id: `${id}.limits`, title: 'Limits on a run', body: describeLimits(limits) },
  ];

  const tryTool: AiToolDescriptor = {
    name: `try_${id}`,
    description:
      'Runs candidate code in the real sandbox and returns its output, logs and error. Use it before settling on an answer, and again after any fix.',
    parameters: TRY_RESULT_SCHEMA,
    execute: async (raw) => {
      const { code, input } = raw as { code: string; input?: unknown };
      const current = resolve?.() ?? {};
      const environment = {
        inputSchema: current.inputSchema ?? inputSchema,
        outputSchema: current.outputSchema ?? outputSchema,
        sampleInput: current.sampleInput ?? sampleInput,
      };

      const result = await executeCode(code, {
        input: input === undefined ? environment.sampleInput : input,
        inputSchema: environment.inputSchema,
        outputSchema: environment.outputSchema,
        functions,
        limits,
      });

      return {
        success: result.success,
        output: result.data,
        error: result.error,
        logs: result.logs,
        durationMs: result.durationMs,
      };
    },
  };

  return { id, sections, tools: [tryTool], artifacts: [] };
};

export type CodeToolOptions = {
  functions?: HostFunctions;
  limits?: ExecutionLimits;
  id?: string;
  /** Extra guidance about the functions, e.g. how the host's data is organised. */
  guidance?: string;
};

/**
 * The executor as something a model **calls**.
 *
 * The complement of the authoring role: here the model does not produce code for
 * a person to keep, it writes code to answer a question and reads the result.
 * Worth having because a sandbox with host functions can do in one call what
 * would otherwise be a dozen tool round-trips — fetch, filter, join, aggregate —
 * and the model gets to use loops and arithmetic rather than approximating them.
 */
export const codeExecutorTool = (options: CodeToolOptions = {}): AiCapability => {
  const { id = 'sandbox', functions = {}, limits = {}, guidance } = options;

  const names = Object.keys(functions);
  const body = [
    `Run code when a question needs more than one lookup, or needs filtering, joining, counting or arithmetic over what a lookup returns. One run replaces a chain of separate calls, and the code can loop.`,
    GUEST_CONTRACT,
    names.length === 0
      ? 'No host functions are available in this run; the code can only transform values you pass in.'
      : `Available functions, bound as globals:\n\n\`\`\`ts\n${describeEnvironment({ functions })}\n\`\`\``,
    guidance,
    'Return the answer as data. Anything logged comes back too, so log what you checked when a result is surprising.',
  ]
    .filter((part): part is string => part !== undefined)
    .join('\n\n');

  return {
    id,
    sections: [{ id: `${id}.usage`, title: 'Running code', body }],
    tools: [
      {
        name: `run_${id}`,
        description: `Runs TypeScript in a sandbox${names.length === 0 ? '' : ` with access to: ${names.join(', ')}`}. Returns the value it returns, plus its logs.`,
        parameters: {
          type: 'object',
          properties: { code: { type: 'string', description: 'A function body.' } },
          required: ['code'],
          additionalProperties: false,
        },
        execute: async (raw) => {
          const { code } = raw as { code: string };
          const result = await executeCode(code, { functions, limits });
          return {
            success: result.success,
            output: result.data,
            error: result.error,
            logs: result.logs,
            calls: result.calls,
          };
        },
      },
    ],
    artifacts: [],
  };
};
