import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * A saved report template: the five parts, under a name.
 *
 * Stored as its own columns rather than one blob because each part is edited on
 * its own — a pane at a time, many times a session — and because the parts are
 * what other features will read. A workflow that generates a report needs the
 * input schema to know what to hand it, without parsing the rest.
 *
 * `createdBy` records the author and nothing more: templates are platform
 * configuration, visible to every admin, not private documents.
 */
// Untyped jsonb on purpose: naming the schema types here drags zod's internal
// JSON-Schema types into the emitted declaration, which is not portable. The
// template shape is enforced where it is read and written, not by the column.
export const reportTemplate = pgTable(
  'report_template',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdBy: text('created_by'),
    inputSchema: jsonb('input_schema').notNull(),
    code: text('code').notNull(),
    outputSchema: jsonb('output_schema').notNull(),
    spec: jsonb('spec').notNull(),
    demoInput: jsonb('demo_input').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('report_template_updated_idx').on(table.updatedAt)],
);

export type ReportTemplateRow = typeof reportTemplate.$inferSelect;
export type NewReportTemplateRow = typeof reportTemplate.$inferInsert;
