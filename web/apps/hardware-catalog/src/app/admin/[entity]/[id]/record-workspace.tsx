'use client';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import { Pencil } from 'lucide-react';

import type { AdminRow, FieldMeta } from '@/lib/field-meta';

import { EntityFormModal, EntityTable, renderCell } from '../../entity-crud';

/**
 * One page for one record: its own fields, then every collection that belongs to it. Each child
 * form has the owner column removed and injected on save, so adding a variant to a product never
 * asks which product it is for.
 */

type Section = {
  slug: string;
  label: string;
  hint?: string;
  routerKey: string;
  parentField: string;
  fields: FieldMeta[];
  columns: string[];
  rows: AdminRow[];
};

/** Fields worth showing in the summary — the rest are visible in the edit dialog. */
const SUMMARY_SKIP = new Set([
  'id',
  'notes',
  'description',
  'sourceId',
  'confidence',
  'verifiedAt',
]);

export const RecordWorkspace = ({
  entitySlug,
  entityLabel,
  routerKey,
  fields,
  row,
  referenceLabels,
  sections,
  title,
}: {
  readonly entitySlug: string;
  readonly entityLabel: string;
  readonly routerKey: string;
  readonly fields: readonly FieldMeta[];
  readonly row: AdminRow;
  readonly referenceLabels: Record<string, string>;
  readonly sections: readonly Section[];
  readonly title: string;
}) => {
  const summaryFields = fields.filter(
    (field) => !SUMMARY_SKIP.has(field.name) && row[field.name] != null && row[field.name] !== '',
  );

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground text-xs">{entityLabel}</p>
          </div>
          <EntityFormModal
            fields={fields}
            label={entityLabel}
            routerKey={routerKey}
            row={row}
            trigger={
              <Button size="sm">
                <Pencil />
                Edit details
              </Button>
            }
          />
        </div>

        <dl className="border-border grid gap-x-6 gap-y-2 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3">
          {summaryFields.map((field) => (
            <div key={field.name} className="min-w-0">
              <dt className="text-muted-foreground text-xs">{field.label}</dt>
              <dd className="truncate text-sm">
                {renderCell(row[field.name], field, referenceLabels)}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      {sections.map((section) => (
        <section key={section.slug} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{section.label}</h2>
            <Badge variant="secondary">{section.rows.length}</Badge>
          </div>
          {section.hint == null ? null : (
            <p className="text-muted-foreground max-w-3xl text-xs">{section.hint}</p>
          )}
          <EntityTable
            addLabel={`Add ${section.label.toLowerCase()}`}
            columns={section.columns}
            fields={section.fields}
            fixedValues={{ [section.parentField]: row.id }}
            label={section.label}
            referenceLabels={referenceLabels}
            routerKey={section.routerKey}
            rows={section.rows}
          />
        </section>
      ))}

      {sections.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing hangs off a {entityLabel.toLowerCase()} record.{' '}
          <a className="underline" href={`/admin/${entitySlug}`}>
            Back to the table
          </a>
        </p>
      ) : null}
    </div>
  );
};
