import type { JSONSchema } from 'zod/v4/core';

const INDENT = '  ';

const IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

const OPENERS = '{[(';
const CLOSERS = '}])';

/**
 * Whether a `|` or `&` sits at the top level of a rendered type.
 *
 * Only those need parenthesising before `[]`: `string | number` must become
 * `(string | number)[]`, but `{ a: string | null }[]` is already unambiguous —
 * checking for the character anywhere would parenthesise every object whose
 * fields happen to be nullable.
 */
const hasTopLevelSeparator = (type: string): boolean => {
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < type.length; index += 1) {
    const character = type[index] as string;

    if (quote !== null) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (OPENERS.includes(character)) {
      depth += 1;
    } else if (CLOSERS.includes(character)) {
      depth -= 1;
    } else if (depth === 0 && (character === '|' || character === '&')) {
      return true;
    }
  }

  return false;
};

/**
 * Converts a JSON Schema into TypeScript source.
 *
 * This is what makes a code editor bound to a schema typesafe: the result is fed
 * to Monaco as `declare const input: <this>`, so the author gets completion and
 * inline errors against the real shape rather than `any`.
 *
 * Covers what `z.toJSONSchema()` emits — objects, arrays, tuples, unions,
 * intersections, enums, const, nullable, `$ref`/`$defs`, optional properties and
 * records. Anything unresolvable degrades to `unknown` rather than throwing: a
 * schema being edited is frequently incomplete, and an editor that dies on a
 * half-written schema is worse than one that briefly says `unknown`.
 */
export const jsonSchemaToTypeString = (
  root: JSONSchema._JSONSchema,
  defs?: Record<string, JSONSchema._JSONSchema>,
): string => {
  const resolvedDefs = defs ?? (typeof root === 'object' ? root.$defs : undefined);

  const convert = (schema: JSONSchema._JSONSchema, depth: number): string => {
    if (typeof schema !== 'object') {
      return schema ? 'unknown' : 'never';
    }

    const indent = INDENT.repeat(depth);
    const innerIndent = INDENT.repeat(depth + 1);

    if (schema.$ref !== undefined) {
      const referenced = resolvedDefs?.[schema.$ref.replace(/^#\/\$defs\//, '')];
      return referenced === undefined ? 'unknown' : convert(referenced, depth);
    }

    // Zod emits nullable as `anyOf: [T, {type: "null"}]`.
    const variants = schema.anyOf ?? schema.oneOf;
    if (variants !== undefined) {
      const nonNull = variants.filter(
        (variant) => !(typeof variant === 'object' && variant.type === 'null'),
      );
      const parts = nonNull.map((variant) => convert(variant, depth));
      if (nonNull.length < variants.length) {
        parts.push('null');
      }
      if (parts.length === 0) {
        return 'never';
      }
      return parts.length === 1 ? (parts[0] as string) : parts.join(' | ');
    }

    if (schema.allOf !== undefined) {
      const parts = schema.allOf.map((variant) => convert(variant, depth));
      if (parts.length === 0) {
        return 'unknown';
      }
      return parts.length === 1
        ? (parts[0] as string)
        : parts.map((part) => `(${part})`).join(' & ');
    }

    if (schema.const !== undefined) {
      return JSON.stringify(schema.const);
    }

    if (schema.enum !== undefined) {
      return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
    }

    switch (schema.type) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'null':
        return 'null';

      case 'array': {
        if (Array.isArray(schema.prefixItems)) {
          return `[${schema.prefixItems.map((item) => convert(item, depth)).join(', ')}]`;
        }

        const { items } = schema;
        if (items === undefined || Array.isArray(items)) {
          return 'unknown[]';
        }

        const element = convert(items, depth);
        return `${hasTopLevelSeparator(element) ? `(${element})` : element}[]`;
      }

      case 'object': {
        // No declared properties but open: a record rather than a shape.
        if (
          schema.properties === undefined &&
          schema.additionalProperties !== undefined &&
          schema.additionalProperties !== false
        ) {
          const key =
            schema.propertyNames === undefined ? 'string' : convert(schema.propertyNames, depth);
          const value =
            schema.additionalProperties === true
              ? 'unknown'
              : convert(schema.additionalProperties, depth);
          return `Record<${key}, ${value}>`;
        }

        if (schema.properties === undefined) {
          return 'Record<string, unknown>';
        }

        const required = new Set(schema.required ?? []);
        const entries = Object.entries(schema.properties);

        if (entries.length === 0) {
          return schema.additionalProperties === false
            ? 'Record<string, never>'
            : 'Record<string, unknown>';
        }

        const lines = entries.map(([key, propertySchema]) => {
          const name = IDENTIFIER.test(key) ? key : JSON.stringify(key);
          const optional = required.has(key) ? '' : '?';
          return `${innerIndent}${name}${optional}: ${convert(propertySchema, depth + 1)};`;
        });

        if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
          const value =
            schema.additionalProperties === true
              ? 'unknown'
              : convert(schema.additionalProperties, depth + 1);
          lines.push(`${innerIndent}[key: string]: ${value};`);
        }

        return `{\n${lines.join('\n')}\n${indent}}`;
      }

      case undefined:
      default:
        return 'unknown';
    }
  };

  return convert(root, 0);
};
