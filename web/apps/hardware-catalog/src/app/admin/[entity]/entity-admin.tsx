'use client';

import Link from 'next/link';

import { Button } from '@helix-hq/design-system/components/button';
import { Plus } from 'lucide-react';

import type { AdminRow, FieldMeta } from '@/lib/field-meta';

import { EntityFormModal, RowActions, renderCell } from '../entity-crud';

/**
 * The flat per-table view. Every row links into its own workspace (`/admin/<entity>/<id>`),
 * which is where the child collections are edited — this screen is for scanning and for the
 * tables that have no children.
 */

type Props = {
  readonly slug: string;
  readonly routerKey: string;
  readonly label: string;
  readonly hint?: string;
  /** The column that ties a row to its owner, if this entity has one. */
  readonly parentField?: string;
  readonly fields: readonly FieldMeta[];
  readonly listColumns: readonly string[];
  readonly rows: readonly AdminRow[];
  readonly total: number;
  /** id → display name, for every foreign key on this entity. */
  readonly referenceLabels: Record<string, string>;
  /** Whether rows have collections of their own worth opening a page for. */
  readonly hasChildren: boolean;
};

export const EntityAdmin = (props: Props) => {
  const fieldsByName = new Map(props.fields.map((field) => [field.name, field]));

  // The owner column narrows this list to one parent ("all compute units of this SoC"); any
  // other foreign key opens that record's own workspace.
  const linkFor = (field: FieldMeta, value: string): string =>
    field.name === props.parentField
      ? `/admin/${props.slug}?parentId=${value}`
      : `/admin/${field.referenceEntity ?? props.slug}/${value}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{props.label}</h1>
          {props.hint == null ? null : (
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{props.hint}</p>
          )}
        </div>
        <EntityFormModal
          fields={props.fields}
          label={props.label}
          routerKey={props.routerKey}
          trigger={
            <Button size="sm">
              <Plus />
              New
            </Button>
          }
        />
      </div>

      {props.rows.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          Nothing here yet. Use <strong>New</strong> to add the first one.
        </p>
      ) : (
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {props.listColumns.map((column) => (
                  <th key={column} className="px-3 py-2 text-left font-medium">
                    {fieldsByName.get(column)?.label ?? column}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => (
                <tr key={row.id} className="border-border border-t">
                  {props.listColumns.map((column, index) => (
                    <td key={column} className="px-3 py-2 align-top">
                      {index === 0 && props.hasChildren ? (
                        <Link
                          className="hover:text-primary font-medium"
                          href={`/admin/${props.slug}/${row.id}`}
                        >
                          {renderCell(row[column], fieldsByName.get(column), props.referenceLabels)}
                        </Link>
                      ) : (
                        renderCell(
                          row[column],
                          fieldsByName.get(column),
                          props.referenceLabels,
                          linkFor,
                        )
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 align-top">
                    <RowActions
                      fields={props.fields}
                      label={props.label}
                      routerKey={props.routerKey}
                      row={row}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
