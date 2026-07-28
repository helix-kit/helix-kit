import { createParser } from 'nuqs/server';
import { z } from 'zod';

import { dataTableConfig } from './config';

import type { ExtendedColumnFilter, ExtendedColumnSort } from './types';

const sortingItemSchema = z.object({
  id: z.string(),
  desc: z.boolean(),
});

/**
 * Creates a `nuqs` parser for JSON-encoded array state while rejecting entries
 * whose `id` values are not part of the current table column set.
 */
const createGenericParser = <T extends { id: string }>(
  schema: z.ZodArray<z.ZodTypeAny>,
  serializeValue: (value: T[]) => string,
  equalityCheck: (a: T[], b: T[]) => boolean,
  columnIds?: string[] | Set<string>,
) => {
  let validKeys: Set<string> | null = null;

  if (columnIds !== undefined) {
    validKeys = columnIds instanceof Set ? columnIds : new Set(columnIds);
  }

  return createParser({
    parse: (value) => {
      try {
        const parsed: unknown = JSON.parse(value);
        const result = schema.safeParse(parsed);

        if (!result.success) {
          return null;
        }

        const data = result.data as T[];
        if (validKeys !== null && data.some((item) => !validKeys.has(item.id))) {
          return null;
        }

        return data;
      } catch {
        return null;
      }
    },
    serialize: serializeValue,
    eq: equalityCheck,
  });
};

/**
 * Returns a query-state parser for TanStack sorting state. When `columnIds` are
 * provided, unknown sort keys are treated as invalid and ignored.
 */
export const getSortingStateParser = <TData>(columnIds?: string[] | Set<string>) => {
  return createGenericParser<ExtendedColumnSort<TData>>(
    z.array(sortingItemSchema),
    (value) => JSON.stringify(value),
    (a, b) =>
      a.length === b.length &&
      a.every((item, index) => item.id === b[index]?.id && item.desc === b[index].desc),
    columnIds,
  );
};

const filterItemSchema = z.object({
  id: z.string(),
  value: z.union([z.string(), z.array(z.string())]),
  variant: z.enum(dataTableConfig.filterVariants),
  operator: z.enum(dataTableConfig.operators),
  filterId: z.string(),
});

/**
 * Shape of each advanced-filter item once it has been validated from the query
 * string. `id` and `filterId` are both preserved because the UI tracks a stable
 * filter row separately from the column key.
 */
export type FilterItemSchema = z.infer<typeof filterItemSchema>;

/**
 * Returns a query-state parser for advanced filter definitions. When
 * `columnIds` are provided, filters targeting unknown columns are rejected.
 */
export const getFiltersStateParser = <TData>(columnIds?: string[] | Set<string>) => {
  return createGenericParser<ExtendedColumnFilter<TData>>(
    z.array(filterItemSchema),
    (value) => JSON.stringify(value),
    (a, b) =>
      a.length === b.length &&
      a.every(
        (filter, index) =>
          filter.id === b[index]?.id &&
          filter.value === b[index].value &&
          filter.variant === b[index].variant &&
          filter.operator === b[index].operator,
      ),
    columnIds,
  );
};
