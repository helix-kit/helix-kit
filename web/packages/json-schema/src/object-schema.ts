import { z } from 'zod';

/** A JSON Schema narrowed to the object shape editors and validators expect. */
export type ResolvedObjectSchema = z.core.JSONSchema.JSONSchema & {
  type: 'object';
  properties: Record<string, z.core.JSONSchema._JSONSchema>;
};

const emptyObjectSchema = (): ResolvedObjectSchema => ({
  type: 'object',
  properties: {},
  additionalProperties: false,
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isZodSchema = (schema: unknown): schema is z.ZodType =>
  isPlainObject(schema) && typeof (schema as { safeParse?: unknown }).safeParse === 'function';

/**
 * Coerces anything schema-shaped into an object schema, falling back to an empty
 * one rather than throwing.
 *
 * An editor bound to a half-written or malformed schema should render an empty
 * form, not crash — the author is mid-edit, and a thrown error there loses their
 * work.
 */
export const toObjectSchema = (
  schema: z.ZodType | z.core.JSONSchema._JSONSchema | undefined,
): ResolvedObjectSchema => {
  if (schema === undefined || typeof schema === 'boolean') {
    return emptyObjectSchema();
  }

  const jsonSchema = isZodSchema(schema)
    ? (z.toJSONSchema(schema) as z.core.JSONSchema._JSONSchema)
    : schema;

  if (typeof jsonSchema !== 'object' || Array.isArray(jsonSchema)) {
    return emptyObjectSchema();
  }

  if (jsonSchema.type !== 'object' && jsonSchema.properties === undefined) {
    return emptyObjectSchema();
  }

  const required = (jsonSchema.required ?? []).filter(
    (entry): entry is string => typeof entry === 'string',
  );

  return {
    ...jsonSchema,
    type: 'object',
    properties: jsonSchema.properties ?? {},
    ...(required.length > 0 ? { required } : {}),
  };
};
