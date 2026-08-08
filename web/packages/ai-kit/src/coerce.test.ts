import { describe, expect, it } from 'vitest';

import { coerceArguments } from './coerce';

import type { JSONSchema } from 'zod/v4/core';

const TEMPLATE_ARGS: JSONSchema.JSONSchema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    demoInput: { type: 'object' },
    spec: { type: 'object' },
    rows: { type: 'array', items: { type: 'object' } },
  },
};

describe('coerceArguments', () => {
  it('parses an object argument that arrived as a JSON string', () => {
    // Observed with deepseek-v4-flash: nested objects reach the tool encoded,
    // and the model then spends its turn theorising about the framework rather
    // than about the report.
    const result = coerceArguments(TEMPLATE_ARGS, {
      code: 'return {};',
      demoInput: '{"devices":[{"id":"a"}]}',
    }) as { demoInput: unknown; code: string };

    expect(result.demoInput).toEqual({ devices: [{ id: 'a' }] });
    expect(result.code).toBe('return {};');
  });

  it('leaves a string argument that is meant to be a string alone', () => {
    const result = coerceArguments(TEMPLATE_ARGS, { code: '{"not":"json"}' }) as { code: string };

    expect(result.code).toBe('{"not":"json"}');
  });

  it('leaves an object that arrived correctly untouched', () => {
    const demoInput = { devices: [] };
    const result = coerceArguments(TEMPLATE_ARGS, { demoInput }) as { demoInput: unknown };

    expect(result.demoInput).toEqual(demoInput);
  });

  it('parses an array argument sent as a string', () => {
    const result = coerceArguments(TEMPLATE_ARGS, { rows: '[{"a":1}]' }) as { rows: unknown };

    expect(result.rows).toEqual([{ a: 1 }]);
  });

  it('coerces inside an array, element by element', () => {
    const result = coerceArguments(TEMPLATE_ARGS, { rows: ['{"a":1}', { a: 2 }] }) as {
      rows: unknown[];
    };

    expect(result.rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('leaves a string that is not valid JSON as it is, so the error is the real one', () => {
    const result = coerceArguments(TEMPLATE_ARGS, { demoInput: 'not json at all' }) as {
      demoInput: unknown;
    };

    expect(result.demoInput).toBe('not json at all');
  });

  it('recurses into nested objects', () => {
    const schema: JSONSchema.JSONSchema = {
      type: 'object',
      properties: {
        outer: { type: 'object', properties: { inner: { type: 'object' } } },
      },
    };

    const result = coerceArguments(schema, { outer: { inner: '{"deep":true}' } }) as {
      outer: { inner: unknown };
    };

    expect(result.outer.inner).toEqual({ deep: true });
  });

  it('parses a union argument whose branches include a structure', () => {
    // The shape an artifact uses when its value may be an object, an array or a
    // scalar. With no top-level type, an encoded object would otherwise be
    // stored as its own JSON text — which is how a generated input schema
    // reached the pipeline as a string.
    const schema: JSONSchema.JSONSchema = {
      type: 'object',
      properties: {
        value: { anyOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }] },
      },
    };

    const result = coerceArguments(schema, { value: '{"type":"object"}' }) as { value: unknown };

    expect(result.value).toEqual({ type: 'object' });
  });

  it('leaves a plain string in a union that also allows strings', () => {
    const schema: JSONSchema.JSONSchema = {
      type: 'object',
      properties: { value: { anyOf: [{ type: 'object' }, { type: 'string' }] } },
    };

    const result = coerceArguments(schema, { value: 'just text' }) as { value: unknown };

    expect(result.value).toBe('just text');
  });

  it('passes through arguments the schema says nothing about', () => {
    const result = coerceArguments(TEMPLATE_ARGS, { unexpected: '{"a":1}' }) as {
      unexpected: unknown;
    };

    // Not described, so not touched: guessing here would be inventing a contract.
    expect(result.unexpected).toBe('{"a":1}');
  });
});
