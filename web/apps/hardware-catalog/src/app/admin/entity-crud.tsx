'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Badge } from '@helix-hq/design-system/components/badge';
import { Button } from '@helix-hq/design-system/components/button';
import { DeleteConfirmDialog } from '@helix-hq/design-system/components/delete-confirm-dialog';
import { MutationModal } from '@helix-hq/design-system/components/mutation-modal';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import type { AdminRow, FieldMeta } from '@/lib/field-meta';
import { useTRPC, useTRPCMutation } from '@/server/react';

import {
  emptyValues,
  formFieldsFor,
  rowToValues,
  schemaForFields,
  valuesToPayload,
} from './entity-form';

/**
 * The create/edit/delete primitives, shared by the flat per-table screens and the per-record
 * workspace. Every CRUD router has the same shape (`crud.ts`), so the router is resolved by key
 * at runtime and one set of components covers every table.
 */

const ISO_DATE_LENGTH = 10;

type RouterProcedures = {
  create: { mutationOptions: (options?: unknown) => never };
  update: { mutationOptions: (options?: unknown) => never };
  delete: { mutationOptions: (options?: unknown) => never };
};

const useEntityRouter = (routerKey: string): RouterProcedures => {
  const api = useTRPC() as unknown as Record<string, RouterProcedures>;
  const router = api[routerKey];
  if (router == null) {
    throw new Error(`Unknown router: ${routerKey}`);
  }
  return router;
};

export const EntityFormModal = ({
  routerKey,
  fields,
  row,
  label,
  trigger,
  fixedValues,
}: {
  readonly routerKey: string;
  readonly fields: readonly FieldMeta[];
  readonly row?: AdminRow;
  readonly label: string;
  readonly trigger: React.ReactNode;
  /**
   * Merged into every payload. On a record workspace this carries the parent id, so the form
   * never asks which product a variant belongs to — it already knows.
   */
  readonly fixedValues?: Record<string, unknown>;
}) => {
  const router = useRouter();
  const procedures = useEntityRouter(routerKey);
  const editing = row != null;

  const mutation = useTRPCMutation(() =>
    editing ? procedures.update.mutationOptions() : procedures.create.mutationOptions(),
  );

  return (
    <MutationModal
      defaultValues={row == null ? emptyValues(fields) : rowToValues(fields, row)}
      fields={formFieldsFor(fields)}
      modalClassName="max-w-2xl"
      mutation={{
        isPending: mutation.isPending,
        mutateAsync: (values: Record<string, unknown>) => {
          const payload = { ...valuesToPayload(fields, values), ...fixedValues };
          return mutation.mutateAsync(
            (editing ? { id: row.id, patch: payload } : payload) as never,
          );
        },
      }}
      refresh={() => {
        router.refresh();
      }}
      schema={schemaForFields(fields)}
      submitButtonText={editing ? 'Save' : 'Create'}
      successToast={() => (editing ? `${label} updated` : `${label} added`)}
      titleText={editing ? `Edit ${label}` : `New ${label}`}
      trigger={trigger}
    />
  );
};

export const RowActions = ({
  routerKey,
  fields,
  row,
  label,
  fixedValues,
}: {
  readonly routerKey: string;
  readonly fields: readonly FieldMeta[];
  readonly row: AdminRow;
  readonly label: string;
  readonly fixedValues?: Record<string, unknown>;
}) => {
  const router = useRouter();
  const procedures = useEntityRouter(routerKey);
  const remove = useTRPCMutation(() =>
    procedures.delete.mutationOptions({
      onSuccess: () => {
        toast.success(`${label} deleted`);
        router.refresh();
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    }),
  );

  return (
    <div className="flex justify-end gap-1">
      <EntityFormModal
        fields={fields}
        fixedValues={fixedValues}
        label={label}
        routerKey={routerKey}
        row={row}
        trigger={
          <Button aria-label="Edit" className="size-8" size="icon" variant="outline">
            <Pencil />
          </Button>
        }
      />
      <DeleteConfirmDialog
        description="This permanently removes the row and anything that cascades from it."
        isPending={remove.isPending}
        title={`Delete this ${label.toLowerCase()}?`}
        trigger={
          <Button aria-label="Delete" className="size-8" size="icon" variant="destructive">
            <Trash2 />
          </Button>
        }
        onConfirm={() => {
          remove.mutate({ id: row.id } as never);
        }}
      />
    </div>
  );
};

export const renderCell = (
  value: unknown,
  field: FieldMeta | undefined,
  referenceLabels: Record<string, string>,
  linkFor?: (field: FieldMeta, value: string) => string,
): React.ReactNode => {
  if (value == null || value === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  if (field?.referenceEntity != null && typeof value === 'string') {
    const name = referenceLabels[value];
    if (name == null) {
      return <span className="font-mono text-xs">{value}</span>;
    }
    return linkFor == null ? (
      name
    ) : (
      <Link className="hover:text-primary" href={linkFor(field, value)}>
        {name}
      </Link>
    );
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? <span className="text-muted-foreground">—</span> : value.join(', ');
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, ISO_DATE_LENGTH);
  }
  if (field?.options != null && typeof value === 'string') {
    const option = field.options.find((entry) => entry.value === value);
    return <Badge variant="secondary">{option?.label ?? value}</Badge>;
  }
  return String(value);
};

/** A table of rows with per-row edit/delete and an add button. */
export const EntityTable = ({
  routerKey,
  label,
  fields,
  columns,
  rows,
  referenceLabels,
  fixedValues,
  linkFor,
  addLabel = 'Add',
}: {
  readonly routerKey: string;
  readonly label: string;
  readonly fields: readonly FieldMeta[];
  readonly columns: readonly string[];
  readonly rows: readonly AdminRow[];
  readonly referenceLabels: Record<string, string>;
  readonly fixedValues?: Record<string, unknown>;
  readonly linkFor?: (field: FieldMeta, value: string) => string;
  readonly addLabel?: string;
}) => {
  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const shown = columns.filter((column) => fieldsByName.has(column));

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
          None yet.
        </p>
      ) : (
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {shown.map((column) => (
                  <th key={column} className="px-3 py-2 text-left font-medium">
                    {fieldsByName.get(column)?.label ?? column}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-border border-t">
                  {shown.map((column) => (
                    <td key={column} className="px-3 py-2 align-top">
                      {renderCell(row[column], fieldsByName.get(column), referenceLabels, linkFor)}
                    </td>
                  ))}
                  <td className="px-3 py-2 align-top">
                    <RowActions
                      fields={fields}
                      fixedValues={fixedValues}
                      label={label}
                      routerKey={routerKey}
                      row={row}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EntityFormModal
        fields={fields}
        fixedValues={fixedValues}
        label={label}
        routerKey={routerKey}
        trigger={
          <Button size="sm" variant="outline">
            <Plus />
            {addLabel}
          </Button>
        }
      />
    </div>
  );
};
