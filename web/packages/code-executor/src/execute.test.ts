import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { executeCode } from './execute';

const schema = (type: z.ZodType) => z.toJSONSchema(type);

describe('the guest contract', () => {
  it('treats the code as a function body and returns what it returns', async () => {
    const result = await executeCode('return 1 + 1;');

    expect(result.success).toBe(true);
    expect(result.data).toBe(2);
  });

  it('exposes the input as `input`', async () => {
    const result = await executeCode('return input.devices.length;', {
      input: { devices: [{ id: 'a' }, { id: 'b' }] },
    });

    expect(result.data).toBe(2);
  });

  it('transpiles TypeScript', async () => {
    const result = await executeCode(
      `
      type Row = { name: string; faults: number };
      const rows: Row[] = input as Row[];
      return rows.filter((row: Row): boolean => row.faults > 0).map((row: Row) => row.name);
    `,
      {
        input: [
          { name: 'a', faults: 0 },
          { name: 'b', faults: 3 },
        ],
      },
    );

    expect(result.data).toEqual(['b']);
  });

  it('reports a compile error without running anything', async () => {
    const result = await executeCode('return (;');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Compile error');
  });

  it('reports a thrown error', async () => {
    const result = await executeCode('throw new Error("nope");');

    expect(result.success).toBe(false);
    expect(result.error).toContain('nope');
  });

  it('returns undefined data when the code returns nothing', async () => {
    const result = await executeCode('const unused = 1;');

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
  });
});

describe('schemas', () => {
  it('rejects input that does not match, before executing', async () => {
    const result = await executeCode('return "never runs";', {
      input: { count: 'not a number' },
      inputSchema: schema(z.object({ count: z.number() })),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Input');
    expect(result.data).toBeUndefined();
  });

  it('rejects output that does not match', async () => {
    const result = await executeCode('return { total: "not a number" };', {
      outputSchema: schema(z.object({ total: z.number() })),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Output');
  });

  it('passes validated data through when both match', async () => {
    const result = await executeCode('return { total: input.a + input.b };', {
      input: { a: 2, b: 3 },
      inputSchema: schema(z.object({ a: z.number(), b: z.number() })),
      outputSchema: schema(z.object({ total: z.number() })),
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ total: 5 });
  });

  it('runs with no schemas at all', async () => {
    const result = await executeCode('return input;', { input: { anything: true } });

    expect(result.data).toEqual({ anything: true });
  });
});

describe('host functions', () => {
  it('binds each under its own name and returns the value directly', async () => {
    const result = await executeCode('return listDevices({ limit: 2 });', {
      functions: {
        listDevices: { handler: (argument) => ({ echoed: argument, devices: ['a', 'b'] }) },
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ echoed: { limit: 2 }, devices: ['a', 'b'] });
    expect(result.calls).toBe(1);
  });

  it('awaits an async handler without the guest seeing a promise', async () => {
    const result = await executeCode('const value = slow(); return value * 2;', {
      functions: {
        slow: {
          handler: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return 21;
          },
        },
      },
    });

    expect(result.data).toBe(42);
  });

  it('surfaces a host error as a catchable guest error', async () => {
    const result = await executeCode(
      'try { boom(null); return "unreached"; } catch (error) { return error.message; }',
      {
        functions: {
          boom: {
            handler: () => {
              throw new Error('host exploded');
            },
          },
        },
      },
    );

    expect(result.data).toBe('host exploded');
  });

  it('names a function the guest calls but the host never registered', async () => {
    const result = await executeCode('return missing();');

    expect(result.success).toBe(false);
    expect(result.error).toContain('missing');
  });

  it('refuses names that are not valid identifiers, since they are bound as globals', async () => {
    const result = await executeCode('return 1;', {
      functions: { 'not valid': { handler: () => null } },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('valid identifiers');
  });

  it('counts calls and stops at the limit', async () => {
    const result = await executeCode(
      'let total = 0; for (let i = 0; i < 10; i++) { total += tick(null); } return total;',
      { functions: { tick: { handler: () => 1 } }, limits: { maxCalls: 3 } },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('3 host function calls');
    expect(result.calls).toBe(3);
  });
});

describe('isolation', () => {
  it.each(['fetch', 'require', 'process', 'XMLHttpRequest', 'WebSocket'])(
    'has no %s',
    async (global) => {
      const result = await executeCode(`return typeof ${global};`);

      expect(result.data).toBe('undefined');
    },
  );

  it('cannot reach the host realm through the constructor escape', async () => {
    const result = await executeCode(
      'return (function(){}).constructor("return typeof process")();',
    );

    // Function() still exists inside the guest, but the realm it compiles into
    // is the sandbox's own — it cannot see the host.
    expect(result.data).toBe('undefined');
  });

  it('sees only the functions it was given', async () => {
    const result = await executeCode('return [typeof allowed, typeof denied].join(",");', {
      functions: { allowed: { handler: () => null } },
    });

    expect(result.data).toBe('function,undefined');
  });
});

describe('limits', () => {
  it('interrupts an infinite loop via the CPU budget', async () => {
    const result = await executeCode('while (true) {} return 1;', { limits: { cpuMs: 200 } });

    expect(result.success).toBe(false);
    expect(result.durationMs).toBeLessThan(5_000);
  });

  it('excludes host time from the CPU budget', async () => {
    // Three 150ms host calls exceed a 250ms CPU budget in wall-clock terms, but
    // none of that time is the guest's, so the run must still succeed.
    const result = await executeCode(
      'let total = 0; for (let i = 0; i < 3; i++) { total += wait(null); } return total;',
      {
        functions: {
          wait: {
            handler: async () => {
              await new Promise((resolve) => setTimeout(resolve, 150));
              return 1;
            },
          },
        },
        limits: { cpuMs: 250, wallClockMs: 10_000 },
      },
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe(3);
    expect(result.durationMs).toBeGreaterThan(400);
  });

  it('still caps the whole run by wall clock, host time included', async () => {
    const result = await executeCode(
      'for (let i = 0; i < 20; i++) { wait(null); } return "done";',
      {
        functions: {
          wait: {
            handler: async () => {
              await new Promise((resolve) => setTimeout(resolve, 50));
              return 1;
            },
          },
        },
        limits: { cpuMs: 10_000, wallClockMs: 200, maxCalls: 100 },
      },
    );

    expect(result.success).toBe(false);
  });

  it('enforces the memory cap', async () => {
    // One allocation past the cap, rather than accumulating up to it: the limit
    // is refused at the point of allocation, so this is immediate.
    const result = await executeCode(
      'const big = new Array(50_000_000).fill(1); return big.length;',
      {
        limits: { memoryBytes: 8 * 1024 * 1024 },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('memory');
  });
});

describe('logging', () => {
  it('captures console output in order', async () => {
    const result = await executeCode(
      'console.log("first"); console.warn("second", 3); return null;',
    );

    expect(result.logs).toEqual(['first', 'second 3']);
  });

  it('serialises objects rather than printing [object Object]', async () => {
    const result = await executeCode('console.log({ a: 1 }); return null;');

    expect(result.logs).toEqual(['{"a":1}']);
  });

  it('caps the buffer so a logging loop cannot exhaust host memory', async () => {
    const result = await executeCode(
      'for (let i = 0; i < 500; i++) { console.log(i); } return "done";',
      { limits: { maxLogs: 10 } },
    );

    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(10);
  });

  it('keeps logs from a run that failed, since they are what explains it', async () => {
    const result = await executeCode('console.log("got here"); throw new Error("then failed");');

    expect(result.success).toBe(false);
    expect(result.logs).toEqual(['got here']);
  });
});

describe('the async contract', () => {
  it('explains `await` rather than reporting a bare syntax error', async () => {
    const result = await executeCode('const value = await something(); return value;');

    expect(result.success).toBe(false);
    expect(result.error).toContain('synchronous');
  });

  it('explains a returned promise, which could never settle here', async () => {
    const result = await executeCode('return Promise.resolve(1);');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Promise');
  });
});

describe('the result', () => {
  it('reports duration and call count on success and on failure', async () => {
    const ok = await executeCode('return 1;');
    const bad = await executeCode('throw new Error("x");');

    for (const result of [ok, bad]) {
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.calls).toBe(0);
      expect(result.logs).toEqual([]);
    }
  });
});
