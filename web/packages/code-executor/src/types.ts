import type { JSONSchema } from 'zod/v4/core';

/**
 * A capability the host lends to the guest, bound as a global under its key.
 *
 * The handler may be sync or async and may do anything the host can do — this
 * package neither knows nor cares what. It is the only route out of the sandbox,
 * so the set a caller passes is exactly the authority the code receives.
 */
export type HostFunction = {
  /** May be sync or async; the executor awaits the result either way. */
  handler: (argument: unknown) => unknown;
  /** Shown to a model when these functions are offered to one as tools. */
  description?: string;
  /** Argument shape, for generated editor types and documentation. */
  parameters?: JSONSchema._JSONSchema;
  /** Return shape, for the same. */
  returns?: JSONSchema._JSONSchema;
};

export type HostFunctions = Record<string, HostFunction>;

/**
 * Ceilings on a single run. Every one exists because a guest is untrusted: code
 * can loop forever, allocate without bound, or hammer a host function.
 */
export type ExecutionLimits = {
  memoryBytes?: number;
  /**
   * Time the guest may spend executing. Time awaiting a host function is
   * excluded, so a slow call never eats the code's own budget.
   */
  cpuMs?: number;
  /** Ceiling on the whole run, host time included. */
  wallClockMs?: number;
  maxCalls?: number;
  maxLogs?: number;
};

export type ExecutionOptions = {
  /** Bound in the guest as `input`. */
  input?: unknown;
  /** Checked before the run; a mismatch fails without executing anything. */
  inputSchema?: JSONSchema._JSONSchema;
  /** Checked after the run, so a caller can trust the shape it gets back. */
  outputSchema?: JSONSchema._JSONSchema;
  functions?: HostFunctions;
  limits?: ExecutionLimits;
};

export type ExecutionResult<T = unknown> = {
  success: boolean;
  data?: T;
  /** Why the run failed: a compile error, a thrown error, a limit, or validation. */
  error?: string;
  /** Whatever the guest logged, in order, capped by `maxLogs`. */
  logs: string[];
  /** How many host functions the guest invoked. */
  calls: number;
  durationMs: number;
};
