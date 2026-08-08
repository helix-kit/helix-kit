import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { describeEnvironment } from './declarations';

const collapse = (source: string): string => source.replace(/\s+/g, ' ').trim();

describe('describeEnvironment', () => {
  it('types `input` from the input schema', () => {
    const result = describeEnvironment({
      inputSchema: z.toJSONSchema(z.object({ devices: z.array(z.object({ faults: z.number() })) })),
    });

    expect(collapse(result)).toBe('declare const input: { devices: { faults: number; }[]; };');
  });

  it('falls back to unknown when no schema is given, rather than any', () => {
    expect(describeEnvironment({})).toBe('declare const input: unknown;');
  });

  it('declares each registered function by name', () => {
    const result = describeEnvironment({
      functions: {
        listDevices: {
          handler: () => null,
          parameters: z.toJSONSchema(z.object({ limit: z.number() })),
          returns: z.toJSONSchema(z.array(z.string())),
        },
      },
    });

    expect(collapse(result)).toContain(
      'declare function listDevices(argument: { limit: number; }): string[];',
    );
  });

  it('declares a plain return type, since a host call blocks rather than resolving', () => {
    const result = describeEnvironment({
      functions: { ping: { handler: () => null, returns: z.toJSONSchema(z.string()) } },
    });

    // A Promise here would invite `await`, which this sandbox cannot support.
    expect(result).toContain('): string;');
    expect(result).not.toContain('Promise');
  });

  it('carries the description through as a doc comment for hovers', () => {
    const result = describeEnvironment({
      functions: { ping: { handler: () => null, description: 'Checks a device is alive.' } },
    });

    expect(result).toContain('/** Checks a device is alive. */');
  });

  it('degrades an undescribed function to unknown rather than omitting it', () => {
    const result = describeEnvironment({ functions: { mystery: { handler: () => null } } });

    expect(collapse(result)).toContain('declare function mystery(argument: unknown): unknown;');
  });

  it('describes input and functions together', () => {
    const result = describeEnvironment({
      inputSchema: z.toJSONSchema(z.object({ id: z.string() })),
      functions: { a: { handler: () => null }, b: { handler: () => null } },
    });

    expect(result).toContain('declare const input:');
    expect(result).toContain('declare function a(');
    expect(result).toContain('declare function b(');
  });
});
