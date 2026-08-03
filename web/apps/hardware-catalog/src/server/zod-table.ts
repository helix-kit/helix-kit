import { getTableColumns } from 'drizzle-orm';
import { z } from 'zod';

import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

/**
 * Derives zod input schemas from a drizzle table. Forty tables would otherwise mean forty
 * hand-maintained schemas drifting from the columns they mirror; deriving them keeps the table
 * definition the single source of truth.
 */

/**
 * drizzle reports refined data types — `number int32`, `string enum` — so only the first word
 * is the category. Matching the whole string silently falls through to `unknown`, which
 * accepts anything and drops the validation entirely.
 */
export const dataTypeOf = (column: PgColumn): string => String(column.dataType).split(' ')[0] ?? '';

const scalarSchema = (column: PgColumn): z.ZodType => {
  const { enumValues } = column;
  if (enumValues != null && enumValues.length > 0) {
    return z.enum(enumValues as [string, ...string[]]);
  }

  switch (dataTypeOf(column)) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'date':
      return z.coerce.date();
    case 'json':
      return z.unknown();
    default:
      return z.unknown();
  }
};

const columnSchema = (column: PgColumn): z.ZodType => {
  // drizzle keeps the element's column type and records array-ness as `dimensions`, so
  // `text('x').array()` is still a `PgText` with `dimensions === 1`.
  const { dimensions } = column;
  let schema = scalarSchema(column);
  for (let depth = 0; depth < dimensions; depth += 1) {
    schema = z.array(schema);
  }
  return schema;
};

/** Columns every table manages itself; never accepted from a caller. */
const MANAGED_COLUMNS = new Set(['id', 'createdAt', 'updatedAt']);

/**
 * Insert schema for a table: required where the column is `notNull` with no default, optional
 * elsewhere, and nullable columns accept `null` explicitly so a writer can clear a value.
 */
export const insertSchemaFor = <TTable extends PgTable>(
  table: TTable,
  options?: { omit?: readonly string[] },
): z.ZodObject => {
  const omit = new Set([...MANAGED_COLUMNS, ...(options?.omit ?? [])]);
  const shape: Record<string, z.ZodType> = {};

  for (const [name, column] of Object.entries(getTableColumns(table))) {
    if (omit.has(name)) {
      continue;
    }
    const base = columnSchema(column);
    if (!column.notNull) {
      shape[name] = base.nullish();
    } else if (column.hasDefault) {
      shape[name] = base.optional();
    } else {
      shape[name] = base;
    }
  }

  return z.object(shape);
};

/** Update schema: every insertable column, all optional. */
export const updateSchemaFor = <TTable extends PgTable>(
  table: TTable,
  options?: { omit?: readonly string[] },
): z.ZodObject => insertSchemaFor(table, options).partial();
