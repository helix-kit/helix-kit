import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createDefaultDefinition,
  definitionToJsonSchema,
  jsonSchemaToDefinition,
  SCHEMA_TYPE_OPTIONS,
  type SchemaDefinition,
} from './definition';

/** Definition → JSON Schema → definition should be the identity. */
const roundTrip = (definition: SchemaDefinition): SchemaDefinition =>
  jsonSchemaToDefinition(definitionToJsonSchema(definition));

describe('definitionToJsonSchema', () => {
  it('emits the primitives', () => {
    expect(definitionToJsonSchema({ type: 'string' })).toEqual({ type: 'string' });
    expect(definitionToJsonSchema({ type: 'number' })).toEqual({ type: 'number' });
    expect(definitionToJsonSchema({ type: 'boolean' })).toEqual({ type: 'boolean' });
    expect(definitionToJsonSchema({ type: 'null' })).toEqual({ type: 'null' });
  });

  it('lists only required properties in `required`', () => {
    const schema = definitionToJsonSchema({
      type: 'object',
      properties: [
        { name: 'id', required: true, nullable: false, schema: { type: 'string' } },
        { name: 'note', required: false, nullable: false, schema: { type: 'string' } },
      ],
    });

    expect(schema.required).toEqual(['id']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('omits `required` entirely when nothing is required', () => {
    const schema = definitionToJsonSchema({
      type: 'object',
      properties: [{ name: 'note', required: false, nullable: false, schema: { type: 'string' } }],
    });

    expect(schema).not.toHaveProperty('required');
  });

  it('expresses nullable as a union with null', () => {
    const schema = definitionToJsonSchema({
      type: 'object',
      properties: [{ name: 'note', required: true, nullable: true, schema: { type: 'string' } }],
    });

    expect(schema.properties?.note).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  });

  it('emits enum, literal and union', () => {
    expect(definitionToJsonSchema({ type: 'enum', values: ['a', 'b'] })).toEqual({
      enum: ['a', 'b'],
    });
    expect(definitionToJsonSchema({ type: 'literal', value: 42 })).toEqual({ const: 42 });
    expect(
      definitionToJsonSchema({ type: 'union', variants: [{ type: 'string' }, { type: 'number' }] }),
    ).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] });
  });
});

describe('round trip', () => {
  it('survives every schema type', () => {
    for (const { value } of SCHEMA_TYPE_OPTIONS) {
      const definition = createDefaultDefinition(value);
      expect(roundTrip(definition), `round trip failed for ${value}`).toEqual(definition);
    }
  });

  it('preserves required and nullable per property', () => {
    const definition: SchemaDefinition = {
      type: 'object',
      properties: [
        { name: 'id', required: true, nullable: false, schema: { type: 'string' } },
        { name: 'count', required: false, nullable: false, schema: { type: 'number' } },
        { name: 'note', required: true, nullable: true, schema: { type: 'string' } },
        { name: 'extra', required: false, nullable: true, schema: { type: 'boolean' } },
      ],
    };

    expect(roundTrip(definition)).toEqual(definition);
  });

  it('survives nesting', () => {
    const definition: SchemaDefinition = {
      type: 'object',
      properties: [
        {
          name: 'devices',
          required: true,
          nullable: false,
          schema: {
            type: 'array',
            items: {
              type: 'object',
              properties: [
                { name: 'name', required: true, nullable: false, schema: { type: 'string' } },
                {
                  name: 'status',
                  required: true,
                  nullable: false,
                  schema: { type: 'enum', values: ['up', 'down'] },
                },
              ],
            },
          },
        },
      ],
    };

    expect(roundTrip(definition)).toEqual(definition);
  });
});

describe('jsonSchemaToDefinition', () => {
  it('reads a schema produced by zod', () => {
    const schema = z.toJSONSchema(
      z.object({
        deviceId: z.string(),
        faults: z.number(),
        note: z.string().nullable(),
        label: z.string().optional(),
      }),
    );

    const definition = jsonSchemaToDefinition(schema);
    expect(definition.type).toBe('object');

    const properties = definition.type === 'object' ? definition.properties : [];
    expect(properties.map((property) => property.name).sort()).toEqual([
      'deviceId',
      'faults',
      'label',
      'note',
    ]);
    expect(properties.find((property) => property.name === 'note')?.nullable).toBe(true);
    expect(properties.find((property) => property.name === 'label')?.required).toBe(false);
    expect(properties.find((property) => property.name === 'deviceId')?.required).toBe(true);
  });

  it('narrows integer to number, since the editor has no separate control', () => {
    expect(jsonSchemaToDefinition({ type: 'integer' })).toEqual({ type: 'number' });
  });

  it('keeps a genuine union rather than mistaking it for nullable', () => {
    expect(jsonSchemaToDefinition({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqual({
      type: 'union',
      variants: [{ type: 'string' }, { type: 'number' }],
    });
  });

  it('unwraps a two-variant nullable union to its inner type', () => {
    expect(jsonSchemaToDefinition({ anyOf: [{ type: 'number' }, { type: 'null' }] })).toEqual({
      type: 'number',
    });
  });

  it('degrades rather than throwing on schemas it cannot model', () => {
    expect(jsonSchemaToDefinition(true)).toEqual({ type: 'string' });
    expect(jsonSchemaToDefinition({})).toEqual({ type: 'string' });
    expect(jsonSchemaToDefinition({ type: 'object' })).toEqual({ type: 'object', properties: [] });
    expect(jsonSchemaToDefinition({ type: 'array' })).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });
});
