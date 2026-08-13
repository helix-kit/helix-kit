'use client';

import { useMemo } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@helix-hq/design-system/components/button';
import { DataTable } from '@helix-hq/design-system/components/data-table';
import { DataTableToolbar } from '@helix-hq/design-system/components/data-table/data-table-toolbar';
import { DeleteConfirmDialog } from '@helix-hq/design-system/components/delete-confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helix-hq/design-system/components/dropdown-menu';
import { MutationModal } from '@helix-hq/design-system/components/mutation-modal';
import { useDataTable } from '@helix-hq/design-system/hooks/use-data-table';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';

import { useTRPCMutation } from '@/server/react';
import type { AppRouter } from '@/server/trpc';

import type { ColumnDef } from '@tanstack/react-table';
import type { inferRouterOutputs } from '@trpc/server';

type TemplateRow = inferRouterOutputs<AppRouter>['reportTemplates']['list']['rows'][number];

const createSchema = z.object({
  name: z.string().min(1, 'Give the template a name'),
  description: z.string().default(''),
});

const formatted = (value: Date | string): string => new Date(value).toLocaleString();

const TemplatesTable = ({ rows, pageCount }: { rows: TemplateRow[]; pageCount: number }) => {
  const router = useRouter();

  const create = useTRPCMutation((api) => api.reportTemplates.create.mutationOptions());
  const remove = useTRPCMutation((api) =>
    api.reportTemplates.remove.mutationOptions({
      onSuccess: () => {
        router.refresh();
      },
    }),
  );

  const columns = useMemo<ColumnDef<TemplateRow>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Name',
        enableColumnFilter: true,
        meta: { label: 'Name', variant: 'text', placeholder: 'Search templates' },
        cell: ({ row }) => (
          <Link className="font-medium hover:underline" href={`/admin/reports/${row.original.id}`}>
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'description',
        accessorKey: 'description',
        header: 'Description',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.description === '' ? '—' : row.original.description}
          </span>
        ),
      },
      {
        id: 'updatedAt',
        accessorKey: 'updatedAt',
        header: 'Updated',
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {formatted(row.original.updatedAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost">
                  <MoreHorizontal />
                  <span className="sr-only">Actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/admin/reports/${row.original.id}`}>
                    <Pencil />
                    Edit
                  </Link>
                </DropdownMenuItem>
                <DeleteConfirmDialog
                  description="The template and every chat about it are removed. This cannot be undone."
                  isPending={remove.isPending}
                  title={`Delete ${row.original.name}?`}
                  trigger={
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={(event) => {
                        event.preventDefault();
                      }}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  }
                  onConfirm={() => {
                    remove.mutate({ id: row.original.id });
                  }}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [remove],
  );

  const { table } = useDataTable({ data: rows, columns, pageCount, shallow: false });

  return (
    <DataTable getItemValue={(template) => template.id} table={table}>
      <DataTableToolbar table={table}>
        <MutationModal
          defaultValues={{ name: '', description: '' }}
          fields={[
            { name: 'name', label: 'Name', type: 'input', placeholder: 'Weekly fleet report' },
            {
              name: 'description',
              label: 'Description',
              type: 'input',
              placeholder: 'What this report is for (optional)',
            },
          ]}
          mutation={create}
          // Straight into the editor: a new template is the default one, and the
          // only reason to make one is to start changing it.
          refresh={(created) => {
            router.push(`/admin/reports/${created.id}`);
          }}
          schema={createSchema}
          successToast={(created) => `Created ${created.name}`}
          titleText="New report template"
          trigger={
            <Button size="sm">
              <Plus />
              New template
            </Button>
          }
        />
      </DataTableToolbar>
    </DataTable>
  );
};

export default TemplatesTable;
