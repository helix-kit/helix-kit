import { newAsyncContext } from 'quickjs-emscripten';
import { transform } from 'sucrase';
import { z } from 'zod';

import { DEFAULT_LIMITS } from './limits';

import type { ExecutionOptions, ExecutionResult, HostFunctions } from './types';
import type { JSONSchema } from 'zod/v4/core';

/** Valid JavaScript identifiers, since each function is bound as a global. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const ASYNC_HINT =
  ' — this sandbox is synchronous: remove `async`/`await`, host functions already return their value directly.';

// QuickJS reports a stray `await` as "expecting ';'" rather than as a
// SyntaxError, so match on how it actually phrases parse failures.
const looksLikeSyntaxError = (message: string): boolean =>
  /syntax|unexpected|reserved|expecting/i.test(message);

const usesAsyncSyntax = (code: string): boolean => /\b(?:async|await)\b/.test(code);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Globals installed before the caller's code runs.
 *
 * Each host function looks synchronous on purpose. The bridge behind it is
 * asyncified, so QuickJS suspends the whole VM until the host promise settles
 * and hands the value back directly — no promise ever reaches the guest. That is
 * not a stylistic choice: driving guest microtasks while a host call is
 * suspended crashes the WASM, so the guest contract has to be synchronous.
 */
const bootstrap = (functionNames: string[], maxLogs: number): string => {
  const bindings = functionNames
    .map(
      (name) => `
  globalThis[${JSON.stringify(name)}] = (argument) => {
    const raw = __hostCall(${JSON.stringify(name)}, JSON.stringify(argument === undefined ? null : argument));
    const parsed = JSON.parse(raw);
    if (!parsed.ok) { throw new Error(parsed.error); }
    return parsed.data;
  };`,
    )
    .join('\n');

  return `
  globalThis.__logs = [];
  const __format = (value) => {
    if (typeof value === 'string') { return value; }
    try { return JSON.stringify(value); } catch (_error) { return String(value); }
  };
  const __log = (...args) => {
    if (globalThis.__logs.length < ${maxLogs}) {
      globalThis.__logs.push(args.map(__format).join(' '));
    }
  };
  globalThis.console = { log: __log, info: __log, warn: __log, error: __log, debug: __log };
${bindings}
  `;
};

const readLogs = (context: { getProp: unknown; global: unknown; dump: unknown }): string[] => {
  const typed = context as {
    getProp: (handle: unknown, key: string) => unknown;
    global: unknown;
    dump: (handle: unknown) => unknown;
  };

  try {
    const handle = typed.getProp(typed.global, '__logs') as { dispose: () => void };
    const value = typed.dump(handle);
    handle.dispose();
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    // The context may already be torn down by an interrupt; logs are best-effort.
    return [];
  }
};

const validate = (
  schema: JSONSchema._JSONSchema | undefined,
  value: unknown,
  label: string,
): unknown => {
  if (schema === undefined) {
    return value;
  }

  const result = z.fromJSONSchema(schema).safeParse(value);
  if (!result.success) {
    throw new Error(`${label}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
};

const assertBindableNames = (functions: HostFunctions): void => {
  const invalid = Object.keys(functions).filter((name) => !IDENTIFIER.test(name));
  if (invalid.length > 0) {
    throw new Error(
      `Host function names must be valid identifiers, since each is bound as a global: ${invalid.join(', ')}`,
    );
  }
};

/**
 * Runs untrusted TypeScript in a QuickJS WASM sandbox.
 *
 * The code is the body of a function: `return` produces the result, and
 * `console.log` records intermediate values. There is no `fetch`, `require`,
 * `process`, filesystem or network — the functions a caller registers are the
 * only way out, which makes the authority the guest holds exactly the set that
 * was passed in.
 *
 * Nothing here knows what the code is *for*. A caller that wants tool calls
 * registers them as functions; one that wants a pure transform registers none
 * and supplies schemas instead.
 */
export const executeCode = async <T = unknown>(
  code: string,
  options: ExecutionOptions = {},
): Promise<ExecutionResult<T>> => {
  const functions = options.functions ?? {};
  const limits = { ...DEFAULT_LIMITS, ...options.limits };

  const startedAt = Date.now();
  let hostMs = 0;
  let calls = 0;
  // The interrupt handler cannot fire while the VM is suspended in a host call,
  // so a guest looping over slow calls would outrun the wall clock unnoticed.
  // The bridge enforces it instead, and this records that it did so: the guest
  // can catch the refusal, but it cannot make the run succeed afterwards.
  //
  // Held on an object rather than in a `let`: the only writer is the bridge
  // callback, and the compiler cannot see that it ran, so a plain binding stays
  // narrowed to `false` at the point it is read.
  const budget = { wallClockExceeded: false };

  const finish = (
    result: Omit<ExecutionResult<T>, 'calls' | 'durationMs'>,
  ): ExecutionResult<T> => ({ ...result, calls, durationMs: Date.now() - startedAt });

  let input: unknown;
  try {
    assertBindableNames(functions);
    input = validate(options.inputSchema, options.input, 'Input');
  } catch (error) {
    return finish({ success: false, error: messageOf(error), logs: [] });
  }

  let transpiled: string;
  try {
    transpiled = transform(code, { transforms: ['typescript'], disableESTransforms: true }).code;
  } catch (error) {
    const hint = usesAsyncSyntax(code) ? ASYNC_HINT : '';
    return finish({ success: false, error: `Compile error: ${messageOf(error)}${hint}`, logs: [] });
  }

  const context = await newAsyncContext();
  try {
    context.runtime.setMemoryLimit(limits.memoryBytes);
    context.runtime.setInterruptHandler(() => {
      const elapsed = Date.now() - startedAt;
      // Host time is excluded from the CPU budget so a slow registered function
      // cannot starve the guest's own allowance, while the wall clock still caps
      // the run as a whole.
      return elapsed > limits.wallClockMs || elapsed - hostMs > limits.cpuMs;
    });

    const bridge = context.newAsyncifiedFunction(
      '__hostCall',
      async (nameHandle, argumentHandle) => {
        const name = context.getString(nameHandle);
        const argumentJson = context.getString(argumentHandle);
        const began = Date.now();

        try {
          if (Date.now() - startedAt > limits.wallClockMs) {
            budget.wallClockExceeded = true;
            throw new Error(`Exceeded the wall-clock budget of ${limits.wallClockMs}ms.`);
          }
          if (calls >= limits.maxCalls) {
            throw new Error(`Exceeded the limit of ${limits.maxCalls} host function calls.`);
          }
          calls += 1;

          const entry = functions[name];
          if (entry === undefined) {
            throw new Error(`No host function named "${name}".`);
          }

          const parsed: unknown = JSON.parse(argumentJson);
          const value = await entry.handler(parsed === null ? undefined : parsed);
          return context.newString(JSON.stringify({ ok: true, data: value ?? null }));
        } catch (error) {
          return context.newString(JSON.stringify({ ok: false, error: messageOf(error) }));
        } finally {
          hostMs += Date.now() - began;
        }
      },
    );
    context.setProp(context.global, '__hostCall', bridge);
    bridge.dispose();

    context
      .unwrapResult(context.evalCode(bootstrap(Object.keys(functions), limits.maxLogs)))
      .dispose();

    const inputHandle = context.unwrapResult(
      context.evalCode(`(${JSON.stringify(input ?? null)})`),
    );
    context.setProp(context.global, 'input', inputHandle);
    inputHandle.dispose();

    // A plain (non-async) IIFE: host calls block via asyncify, so the whole
    // program completes in this one evaluation with no pending jobs.
    const handle = context.unwrapResult(
      await context.evalCodeAsync(`(() => {\n"use strict";\n${transpiled}\n})()`),
    );

    // An `async` helper resolves to a promise that can never settle here — its
    // continuation needs the job queue, which asyncified host calls forbid.
    // Dumping it yields an opaque internal error, so name the real problem.
    if (isThenable(context, handle)) {
      handle.dispose();
      return finish({
        success: false,
        error: `The code returned a Promise${ASYNC_HINT}`,
        logs: readLogs(context),
      });
    }

    const output: unknown = context.dump(handle);
    handle.dispose();

    const logs = readLogs(context);

    if (budget.wallClockExceeded) {
      return finish({
        success: false,
        error: `Exceeded the wall-clock budget of ${limits.wallClockMs}ms.`,
        logs,
      });
    }

    try {
      return finish({
        success: true,
        data: validate(options.outputSchema, output, 'Output') as T,
        logs,
      });
    } catch (error) {
      return finish({ success: false, error: messageOf(error), logs });
    }
  } catch (error) {
    const message = messageOf(error);
    const hint = looksLikeSyntaxError(message) && usesAsyncSyntax(code) ? ASYNC_HINT : '';
    return finish({ success: false, error: `${message}${hint}`, logs: readLogs(context) });
  } finally {
    try {
      context.dispose();
    } catch {
      // Already torn down by an interrupt — nothing left to release.
    }
  }
};

type AsyncContext = Awaited<ReturnType<typeof newAsyncContext>>;

/** Whether a guest value is promise-like, without dumping it. */
const isThenable = (
  context: AsyncContext,
  handle: Parameters<AsyncContext['dump']>[0],
): boolean => {
  if (context.typeof(handle) !== 'object') {
    return false;
  }

  const then = context.getProp(handle, 'then');
  const isFunction = context.typeof(then) === 'function';
  then.dispose();
  return isFunction;
};
