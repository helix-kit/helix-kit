import { randomUUID } from 'node:crypto';

import { createRouterFactory, TRPCError } from '@helix/backend/trpc';
import { asc, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { reportTemplate } from './schema';

import type { ReportTemplate } from '../types';
import type { DatabaseClient } from '@helix/backend/db';

import { defaultReportTemplate } from '../defaults';

export type ReportTemplateSessionUser = Readonly<{ id: string; role: string | null }>;

export type ReportTemplateContext = Readonly<{
  db: DatabaseClient;
  user: ReportTemplateSessionUser | null;
  adminRoles: readonly string[];
}>;

const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 500;
const PER_PAGE_MAX = 100;
const PER_PAGE_DEFAULT = 10;

const SORTABLE = {
  name: reportTemplate.name,
  createdAt: reportTemplate.createdAt,
  updatedAt: reportTemplate.updatedAt,
} as const;

/** The parts a template is made of, each editable on its own. */
const templateParts = z.object({
  inputSchema: z.unknown().optional(),
  code: z.string().optional(),
  outputSchema: z.unknown().optional(),
  spec: z.unknown().optional(),
  demoInput: z.unknown().optional(),
});

export const reportTemplatesRouter = createRouterFactory<ReportTemplateContext>()((t) => {
  const adminProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to manage report templates' });
    }
    if (!ctx.adminRoles.includes(ctx.user.role ?? '')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Report templates are admin-only' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  return t.router({
    list: adminProcedure
      .input(
        z.object({
          page: z.number().int().min(1).default(1),
          perPage: z.number().int().min(1).max(PER_PAGE_MAX).default(PER_PAGE_DEFAULT),
          name: z.string().default(''),
          sort: z.string().default(''),
        }),
      )
      .query(async ({ ctx, input }) => {
        const where: SQL | undefined =
          input.name === '' ? undefined : ilike(reportTemplate.name, `%${input.name}%`);

        const [{ count } = { count: 0 }] = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(reportTemplate)
          .where(where);

        const [sortColumn = 'updatedAt', direction = 'desc'] = input.sort.split('.');
        // A sort key from the URL is not necessarily one we sort by.
        const column = Object.hasOwn(SORTABLE, sortColumn)
          ? SORTABLE[sortColumn as keyof typeof SORTABLE]
          : reportTemplate.updatedAt;

        const rows = await ctx.db
          .select({
            id: reportTemplate.id,
            name: reportTemplate.name,
            description: reportTemplate.description,
            createdAt: reportTemplate.createdAt,
            updatedAt: reportTemplate.updatedAt,
          })
          .from(reportTemplate)
          .where(where)
          .orderBy(direction === 'asc' ? asc(column) : desc(column))
          .limit(input.perPage)
          .offset((input.page - 1) * input.perPage);

        return { rows, pageCount: Math.max(1, Math.ceil(count / input.perPage)) };
      }),

    get: adminProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(reportTemplate)
        .where(eq(reportTemplate.id, input.id))
        .limit(1);
      if (row === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      }
      return row;
    }),

    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1).max(NAME_MAX_LENGTH),
          description: z.string().max(DESCRIPTION_MAX_LENGTH).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // A new template starts from the default one: an empty template cannot
        // be previewed, so there would be nothing to react to until it was
        // finished, and the editor is built around seeing what you have.
        const [row] = await ctx.db
          .insert(reportTemplate)
          .values({
            id: randomUUID(),
            name: input.name,
            description: input.description,
            createdBy: ctx.user.id,
            ...defaultReportTemplate,
          })
          .returning();
        return row;
      }),

    update: adminProcedure
      .input(
        z
          .object({
            id: z.string(),
            name: z.string().min(1).max(NAME_MAX_LENGTH).optional(),
            description: z.string().max(DESCRIPTION_MAX_LENGTH).optional(),
          })
          .and(templateParts),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...rest } = input;
        // Only what was sent: the editor saves the pane that changed, and a
        // whole-template write would let one stale pane overwrite a fresh one.
        const changes = Object.fromEntries(
          Object.entries(rest).filter(([, value]) => value !== undefined),
        );
        if (Object.keys(changes).length === 0) {
          return { id };
        }

        const updated = await ctx.db
          .update(reportTemplate)
          .set(changes as Partial<ReportTemplate>)
          .where(eq(reportTemplate.id, id))
          .returning({ id: reportTemplate.id });
        if (updated.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
        }
        return { id };
      }),

    remove: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      await ctx.db.delete(reportTemplate).where(eq(reportTemplate.id, input.id));
      return { id: input.id };
    }),
  });
});

export type ReportTemplatesRouter = ReturnType<typeof reportTemplatesRouter>;
