import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { jsonSchemaToTypeString } from './type-string';

import type { JSONSchema } from 'zod/v4/core';

/** What a caller actually does: build with zod, hand the JSON Schema to Monaco. */
const fromZod = (schema: z.ZodType): string => jsonSchemaToTypeString(z.toJSONSchema(schema));

const RECORD_UNKNOWN = 'Record<string, unknown>';
const LITERAL_NUMBER = 7;

const collapse = (source: string): string => source.replace(/\s+/g, ' ').trim();

describe('jsonSchemaToTypeString', () => {
  it('converts the primitives', () => {
    expect(fromZod(z.string())).toBe('string');
    expect(fromZod(z.number())).toBe('number');
    expect(fromZod(z.boolean())).toBe('boolean');
    expect(fromZod(z.null())).toBe('null');
    expect(jsonSchemaToTypeString({ type: 'integer' })).toBe('number');
  });

  it('marks non-required properties optional', () => {
    const result = fromZod(z.object({ id: z.string(), label: z.string().optional() }));

    expect(collapse(result)).toBe('{ id: string; label?: string; }');
  });

  it('unions nullable with null rather than dropping it', () => {
    const result = fromZod(z.object({ note: z.string().nullable() }));

    expect(collapse(result)).toBe('{ note: string | null; }');
  });

  it('nests objects with indentation', () => {
    const result = fromZod(z.object({ device: z.object({ name: z.string() }) }));

    expect(result).toBe('{\n  device: {\n    name: string;\n  };\n}');
  });

  it('parenthesises array elements that would otherwise reparse', () => {
    // `string | number[]` means something else entirely.
    const result = jsonSchemaToTypeString({
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'number' }] },
    });

    expect(result).toBe('(string | number)[]');
  });

  it('converts arrays of objects', () => {
    const result = fromZod(z.object({ rows: z.array(z.object({ name: z.string() })) }));

    expect(collapse(result)).toBe('{ rows: { name: string; }[]; }');
  });

  it('converts enums and literals to unions of literal types', () => {
    expect(fromZod(z.enum(['up', 'down']))).toBe('"up" | "down"');
    expect(fromZod(z.literal('fixed'))).toBe('"fixed"');
    expect(fromZod(z.literal(LITERAL_NUMBER))).toBe(String(LITERAL_NUMBER));
  });

  it('converts tuples via prefixItems', () => {
    expect(fromZod(z.tuple([z.string(), z.number()]))).toBe('[string, number]');
  });

  it('converts open objects to Record', () => {
    expect(
      jsonSchemaToTypeString({ type: 'object', additionalProperties: { type: 'number' } }),
    ).toBe('Record<string, number>');
    expect(jsonSchemaToTypeString({ type: 'object', additionalProperties: true })).toBe(
      RECORD_UNKNOWN,
    );
    expect(jsonSchemaToTypeString({ type: 'object' })).toBe(RECORD_UNKNOWN);
  });

  it('distinguishes a closed empty object from an open one', () => {
    expect(
      jsonSchemaToTypeString({ type: 'object', properties: {}, additionalProperties: false }),
    ).toBe('Record<string, never>');
    expect(jsonSchemaToTypeString({ type: 'object', properties: {} })).toBe(RECORD_UNKNOWN);
  });

  it('adds an index signature when an object is also open', () => {
    const result = jsonSchemaToTypeString({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: { type: 'number' },
    });

    expect(collapse(result)).toBe('{ id: string; [key: string]: number; }');
  });

  it('quotes property names that are not identifiers', () => {
    const result = jsonSchemaToTypeString({
      type: 'object',
      properties: { 'device-id': { type: 'string' } },
      required: ['device-id'],
    });

    expect(collapse(result)).toBe('{ "device-id": string; }');
  });

  it('resolves $ref against $defs', () => {
    const schema: JSONSchema._JSONSchema = {
      $defs: {
        Device: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
      type: 'object',
      properties: { device: { $ref: '#/$defs/Device' } },
      required: ['device'],
    };

    expect(collapse(jsonSchemaToTypeString(schema))).toBe('{ device: { id: string; }; }');
  });

  it('converts allOf to an intersection', () => {
    const result = jsonSchemaToTypeString({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    });

    expect(collapse(result)).toBe('({ a: string; }) & ({ b: number; })');
  });

  it('degrades to unknown instead of throwing, so a half-written schema still edits', () => {
    expect(jsonSchemaToTypeString({})).toBe('unknown');
    expect(jsonSchemaToTypeString(true)).toBe('unknown');
    expect(jsonSchemaToTypeString(false)).toBe('never');
    expect(jsonSchemaToTypeString({ $ref: '#/$defs/Missing' })).toBe('unknown');
    expect(jsonSchemaToTypeString({ type: 'array' })).toBe('unknown[]');
  });

  it('produces source that describes a realistic report input', () => {
    const result = fromZod(
      z.object({
        reportTitle: z.string(),
        devices: z.array(
          z.object({
            name: z.string(),
            profile: z.string(),
            uptimeSeconds: z.number(),
            faults: z.number(),
            lastSeenAt: z.string().nullable(),
          }),
        ),
      }),
    );

    expect(collapse(result)).toBe(
      '{ reportTitle: string; devices: { name: string; profile: string; uptimeSeconds: number; faults: number; lastSeenAt: string | null; }[]; }',
    );
  });
});

describe('array element parenthesisation', () => {
  it('wraps a top-level union', () => {
    expect(
      jsonSchemaToTypeString({
        type: 'array',
        items: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      }),
    ).toBe('(string | number)[]');
  });

  it('leaves an object alone even when its fields are unions', () => {
    const result = jsonSchemaToTypeString({
      type: 'array',
      items: {
        type: 'object',
        properties: { note: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
        required: ['note'],
      },
    });

    expect(collapse(result)).toBe('{ note: string | null; }[]');
  });

  it('is not fooled by a separator inside a string literal type', () => {
    expect(jsonSchemaToTypeString({ type: 'array', items: { const: 'a|b' } })).toBe('"a|b"[]');
  });
});
