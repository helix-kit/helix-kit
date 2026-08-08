const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
const MEMORY_LIMIT_MB = 128;

/**
 * Defaults sized for an interactive run: generous enough that ordinary data
 * shaping never hits them, tight enough that a runaway guest is cut off while
 * someone is still watching.
 *
 * `wallClockMs` is far above `cpuMs` because host functions may legitimately
 * take seconds; the CPU budget is what bounds the code's own work.
 */
export const DEFAULT_LIMITS = {
  memoryBytes: MEMORY_LIMIT_MB * BYTES_PER_MB,
  cpuMs: 5_000,
  wallClockMs: 45_000,
  maxCalls: 40,
  maxLogs: 100,
} as const;
