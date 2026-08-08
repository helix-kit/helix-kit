import type { JSONSchema } from 'zod/v4/core';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const expectedType = (schema: JSONSchema._JSONSchema): string | undefined => {
  if (typeof schema !== 'object') {
    return undefined;
  }
  const { type } = schema;
  return typeof type === 'string' ? type : undefined;
};

/**
 * Reconciles tool arguments with the schema they were meant to satisfy.
 *
 * Providers do not agree on how a nested object reaches a tool: some send it as
 * a value, some as a JSON string. A tool that receives the string form sees a
 * type error it cannot explain, and a model given that error concludes the
 * framework is at fault and starts trying workarounds — quoting, restringifying,
 * omitting the argument — burning a turn on a problem it cannot fix from where
 * it sits. Better to accept both spellings here, once.
 *
 * Only structural coercion: a string that should be an object or array is
 * parsed, recursively. Anything else is left exactly as it arrived, so a genuine
 * type error still reaches the model as one.
 */
export const coerceArguments = (schema: JSONSchema._JSONSchema, input: unknown): unknown => {
  if (typeof schema !== 'object') {
    return input;
  }

  const type = expectedType(schema);

  // A union of shapes has no single `type`, but if any branch wants a structure
  // then a string that parses to one was meant to be that structure. Without
  // this an artifact declared as `anyOf` — the shape used when a value may be an
  // object, an array or a scalar — slips through encoded.
  if (typeof input === 'string' && type === undefined && Array.isArray(schema.anyOf)) {
    const structural = schema.anyOf.some((branch) => {
      const branchType = expectedType(branch as JSONSchema._JSONSchema);
      return branchType === 'object' || branchType === 'array';
    });
    if (structural) {
      // A string that does not parse comes back unchanged, which is right: the
      // union allows a plain string too.
      return parseJson(input);
    }
  }

  if (typeof input === 'string' && (type === 'object' || type === 'array')) {
    const parsed = parseJson(input);
    // Still a string means it was not JSON. Recursing would re-enter this branch
    // with the same value forever, and the argument is anyway a genuine type
    // error that belongs in front of the model rather than hidden here.
    return typeof parsed === 'string' ? parsed : coerceArguments(schema, parsed);
  }

  if (type === 'object' || (type === undefined && isRecord(input) && 'properties' in schema)) {
    if (!isRecord(input)) {
      return input;
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const result: Record<string, unknown> = { ...input };
    for (const [key, value] of Object.entries(input)) {
      const property = properties[key];
      if (property !== undefined) {
        result[key] = coerceArguments(property as JSONSchema._JSONSchema, value);
      }
    }
    return result;
  }

  if (type === 'array' && Array.isArray(input)) {
    const { items } = schema;
    if (items === undefined || Array.isArray(items)) {
      return input;
    }
    return input.map((entry) => coerceArguments(items as JSONSchema._JSONSchema, entry));
  }

  return input;
};
