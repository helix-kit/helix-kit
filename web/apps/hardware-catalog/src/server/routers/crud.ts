import { TRPCError } from '@helix-hq/backend/trpc';
import { and, asc, count, eq, ilike, or, type InferSelectModel, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { catalogRouter } from '../context';
import { createId } from '../ids';
import { insertSchemaFor, updateSchemaFor } from '../zod-table';

/**
 * One CRUD implementation for every entity in the catalog. There are around forty tables and
 * their read/write surface is identical — list with a search and an optional parent filter,
 * fetch, create, update, delete — so it is written once and specialised by configuration.
 * Entity-specific reads (the silicon graph, comparison) live in their own routers.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type AnyEntityTable = PgTable & { id: PgColumn };

export type EntityRouterConfig = {
  /** The drizzle table. Must expose a text `id` primary key. */
  table: AnyEntityTable;
  /** Prefix for generated ids, e.g. `sil` → `sil_1f2e…`. */
  idPrefix: string;
  /** Columns a free-text search matches against. */
  searchColumns?: readonly PgColumn[];
  /** Default ordering column. */
  orderBy: PgColumn;
  /** When set, `list` accepts a `parentId` filter against this column. */
  parentColumn?: PgColumn;
  /** Unique human-addressable column, if the entity has one. */
  slugColumn?: PgColumn;
};

const listInput = z.object({
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(0),
  search: z.string().trim().default(''),
  parentId: z.string().optional(),
});

const buildFilters = (config: EntityRouterConfig, input: z.infer<typeof listInput>): SQL[] => {
  const filters: SQL[] = [];

  if (input.search !== '' && config.searchColumns != null && config.searchColumns.length > 0) {
    const pattern = `%${input.search}%`;
    const matches = config.searchColumns.map((column) => ilike(column, pattern));
    const combined = matches.length === 1 ? matches[0] : or(...matches);
    if (combined != null) {
      filters.push(combined);
    }
  }

  if (input.parentId != null && config.parentColumn != null) {
    filters.push(eq(config.parentColumn, input.parentId));
  }

  return filters;
};

/**
 * `TTable` exists only so the caller's concrete table narrows the returned row type. Inside,
 * the table is widened to `AnyEntityTable`: drizzle's builder types cannot resolve a generic
 * table parameter, and every result is re-narrowed on the way out.
 */
export const createEntityRouter = <TTable extends AnyEntityTable>(
  config: EntityRouterConfig & { table: TTable },
) => {
  // Not destructured on purpose: the explicit annotation is what widens the generic away.
  // eslint-disable-next-line prefer-destructuring
  const table: AnyEntityTable = config.table;
  const createInput = insertSchemaFor(table);
  const patchInput = updateSchemaFor(table);

  type Row = InferSelectModel<TTable>;
  const asRows = (rows: unknown): Row[] => rows as Row[];

  return catalogRouter((t) =>
    t.router({
      list: t.procedure.input(listInput).query(async ({ ctx, input }) => {
        const filters = buildFilters(config, input);
        const where = filters.length === 0 ? undefined : and(...filters);

        const [items, totals] = await Promise.all([
          ctx.db
            .select()
            .from(table)
            .where(where)
            .orderBy(asc(config.orderBy))
            .limit(input.limit)
            .offset(input.offset),
          ctx.db.select({ value: count() }).from(table).where(where),
        ]);

        return { items: asRows(items), total: totals[0]?.value ?? 0 };
      }),

      byId: t.procedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
        const rows = await ctx.db.select().from(table).where(eq(table.id, input.id)).limit(1);
        return asRows(rows)[0] ?? null;
      }),

      bySlug: t.procedure.input(z.object({ slug: z.string() })).query(async ({ ctx, input }) => {
        if (config.slugColumn == null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Entity has no slug' });
        }
        const rows = await ctx.db
          .select()
          .from(table)
          .where(eq(config.slugColumn, input.slug))
          .limit(1);
        return asRows(rows)[0] ?? null;
      }),

      create: t.procedure.input(createInput).mutation(async ({ ctx, input }) => {
        const values = { ...input, id: createId(config.idPrefix) };
        const rows = await ctx.db
          .insert(table)
          .values(values as never)
          .returning();
        return asRows(rows)[0];
      }),

      update: t.procedure
        .input(z.object({ id: z.string(), patch: patchInput }))
        .mutation(async ({ ctx, input }) => {
          const rows = asRows(
            await ctx.db
              .update(table)
              .set(input.patch as never)
              .where(eq(table.id, input.id))
              .returning(),
          );
          if (rows.length === 0) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Row not found' });
          }
          return rows[0];
        }),

      delete: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
        const rows = asRows(await ctx.db.delete(table).where(eq(table.id, input.id)).returning());
        if (rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Row not found' });
        }
        return { id: input.id };
      }),
    }),
  );
};
