import type { JSONSchema } from 'zod/v4/core';

/**
 * The schema shapes an author can build in the UI.
 *
 * A deliberate subset of JSON Schema: enough to describe the data a report or a
 * tool exchanges, small enough that every case has an obvious editor control.
 */
export type SchemaType =
  'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'enum' | 'literal' | 'union';

export const SCHEMA_TYPE_OPTIONS: { value: SchemaType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'null', label: 'Null' },
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'Array' },
  { value: 'enum', label: 'Enum' },
  { value: 'literal', label: 'Literal' },
  { value: 'union', label: 'Union' },
];

export type PropertyDescriptor = {
  name: string;
  required: boolean;
  nullable: boolean;
  schema: SchemaDefinition;
};

/**
 * The editable form of a schema.
 *
 * JSON Schema is a poor thing to edit directly — nullability, optionality and
 * unions are all expressed as nested combinators. This flattens those into the
 * three things an author actually thinks about (type, required, nullable) and
 * converts back and forth.
 */
export type SchemaDefinition =
  | { type: 'string' }
  | { type: 'number' }
  | { type: 'boolean' }
  | { type: 'null' }
  | { type: 'object'; properties: PropertyDescriptor[] }
  | { type: 'array'; items: SchemaDefinition }
  | { type: 'enum'; values: string[] }
  | { type: 'literal'; value: string | number | boolean }
  | { type: 'union'; variants: SchemaDefinition[] };

const wrapNullable = (schema: JSONSchema.JSONSchema, nullable: boolean): JSONSchema.JSONSchema =>
  nullable ? { anyOf: [schema, { type: 'null' }] } : schema;

export const definitionToJsonSchema = (definition: SchemaDefinition): JSONSchema.JSONSchema => {
  switch (definition.type) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'null':
      return { type: 'null' };
    case 'object': {
      const properties: Record<string, JSONSchema.JSONSchema> = {};
      const required: string[] = [];

      for (const property of definition.properties) {
        properties[property.name] = wrapNullable(
          definitionToJsonSchema(property.schema),
          property.nullable,
        );
        if (property.required) {
          required.push(property.name);
        }
      }

      return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      };
    }
    case 'array':
      return { type: 'array', items: definitionToJsonSchema(definition.items) };
    case 'enum':
      return { enum: definition.values };
    case 'literal':
      return { const: definition.value };
    case 'union':
      return { anyOf: definition.variants.map(definitionToJsonSchema) };
    default:
      return {};
  }
};

/** Splits `anyOf: [T, null]` back into "T, nullable" — how the editor models it. */
const splitNullable = (
  schema: JSONSchema._JSONSchema,
): { schema: JSONSchema._JSONSchema; nullable: boolean } => {
  if (typeof schema !== 'object') {
    return { schema, nullable: false };
  }

  const variants = schema.anyOf ?? schema.oneOf;
  if (variants === undefined) {
    return { schema, nullable: false };
  }

  const nonNull = variants.filter(
    (variant) => !(typeof variant === 'object' && variant.type === 'null'),
  );

  return nonNull.length === variants.length - 1 && nonNull.length === 1
    ? { schema: nonNull[0] as JSONSchema._JSONSchema, nullable: true }
    : { schema, nullable: false };
};

export const jsonSchemaToDefinition = (schema: JSONSchema._JSONSchema): SchemaDefinition => {
  // A boolean schema carries no shape to edit; start the author on a string.
  if (typeof schema !== 'object') {
    return { type: 'string' };
  }

  if (schema.const !== undefined) {
    return { type: 'literal', value: schema.const as string | number | boolean };
  }

  if (schema.enum !== undefined) {
    return { type: 'enum', values: schema.enum.map((entry) => String(entry)) };
  }

  const variants = schema.anyOf ?? schema.oneOf;
  if (variants !== undefined) {
    const unwrapped = splitNullable(schema);
    if (unwrapped.nullable) {
      return jsonSchemaToDefinition(unwrapped.schema);
    }

    return {
      type: 'union',
      variants: variants.map((variant) => jsonSchemaToDefinition(variant)),
    };
  }

  switch (schema.type) {
    case 'string':
      return { type: 'string' };
    case 'number':
    case 'integer':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'null':
      return { type: 'null' };
    case 'array': {
      const { items } = schema;
      return items !== undefined && !Array.isArray(items)
        ? { type: 'array', items: jsonSchemaToDefinition(items) }
        : { type: 'array', items: { type: 'string' } };
    }
    case 'object': {
      if (schema.properties === undefined) {
        return { type: 'object', properties: [] };
      }

      const required = new Set(schema.required ?? []);
      const properties = Object.entries(schema.properties).map(([name, propertySchema]) => {
        const unwrapped = splitNullable(propertySchema);
        return {
          name,
          required: required.has(name),
          nullable: unwrapped.nullable,
          schema: jsonSchemaToDefinition(unwrapped.schema),
        };
      });

      return { type: 'object', properties };
    }
    case undefined:
    default:
      return { type: 'string' };
  }
};

export const createDefaultDefinition = (type: SchemaType): SchemaDefinition => {
  switch (type) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'null':
      return { type: 'null' };
    case 'object':
      return { type: 'object', properties: [] };
    case 'array':
      return { type: 'array', items: { type: 'string' } };
    case 'enum':
      return { type: 'enum', values: ['value1'] };
    case 'literal':
      return { type: 'literal', value: '' };
    case 'union':
      return { type: 'union', variants: [{ type: 'string' }, { type: 'number' }] };
    default:
      return { type: 'string' };
  }
};

export const createDefaultProperty = (name: string): PropertyDescriptor => ({
  name,
  required: true,
  nullable: false,
  schema: { type: 'string' },
});
