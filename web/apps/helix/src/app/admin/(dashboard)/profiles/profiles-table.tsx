'use client';

import { useMemo } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@helix/design-system/components/button';
import { DataTable } from '@helix/design-system/components/data-table';
import { DataTableToolbar } from '@helix/design-system/components/data-table/data-table-toolbar';
import { DeleteConfirmDialog } from '@helix/design-system/components/delete-confirm-dialog';
import { MutationModal } from '@helix/design-system/components/mutation-modal';
import { TableActions } from '@helix/design-system/components/table-actions';
import { useDataTable } from '@helix/design-system/hooks/use-data-table';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { useTRPCMutation } from '@/server/react';
import type { AppRouter } from '@/server/trpc';

import type { inferRouterOutputs } from '@trpc/server';

type ProfileRow = inferRouterOutputs<AppRouter>['profiles']['list']['rows'][number];

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

const NAME_MAX = 200;
const DESCRIPTION_MAX = 500;

const createProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(NAME_MAX),
  description: z.string().max(DESCRIPTION_MAX).optional(),
});

const CreateProfileButton = () => {
  const router = useRouter();
  const create = useTRPCMutation((api) => api.profiles.create.mutationOptions());
  return (
    <MutationModal
      defaultValues={{ name: '', description: '' }}
      fields={[
        { name: 'name', label: 'Name', type: 'input', placeholder: 'esp32-4mb-sensors' },
        { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional' },
      ]}
      mutation={create}
      refresh={() => {
        router.refresh();
      }}
      schema={createProfileSchema}
      successToast={() => 'Profile created'}
      titleText="Create profile"
      trigger={
        <Button size="sm">
          <Plus />
          New profile
        </Button>
      }
    />
  );
};

const RowActions = ({ profile }: { profile: ProfileRow }) => {
  const router = useRouter();
  const remove = useTRPCMutation((api) =>
    api.profiles.delete.mutationOptions({
      onSuccess: () => {
        toast.success('Profile deleted');
        router.refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  return (
    <TableActions>
      <DeleteConfirmDialog
        description={`This deletes "${profile.name}", its tracks, and its device assignments. This cannot be undone.`}
        isPending={remove.isPending}
        title="Delete profile?"
        trigger={
          <Button aria-label="Delete profile" className="size-8" size="icon" variant="destructive">
            <Trash2 />
          </Button>
        }
        onConfirm={() => {
          remove.mutate({ id: profile.id });
        }}
      />
    </TableActions>
  );
};

export const ProfilesTable = ({ rows, pageCount }: { rows: ProfileRow[]; pageCount: number }) => {
  const columns = useMemo<ColumnDef<ProfileRow>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => (
          <Button
            className="-ml-2.5"
            size="sm"
            variant="ghost"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === 'asc');
            }}
          >
            Name
            <ArrowUpDown />
          </Button>
        ),
        cell: ({ row }) => (
          <Link className="font-medium hover:underline" href={`/admin/profiles/${row.original.id}`}>
            {row.original.name}
          </Link>
        ),
        enableColumnFilter: true,
        meta: { label: 'Name', variant: 'text', placeholder: 'Filter names...' },
      },
      {
        id: 'description',
        accessorKey: 'description',
        header: 'Description',
        cell: ({ row }) => (
          <span className="text-muted-foreground truncate text-xs">
            {row.original.description ?? '—'}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: 'trackCount',
        accessorKey: 'trackCount',
        header: 'Tracks',
        cell: ({ row }) => <span className="tabular-nums">{row.original.trackCount}</span>,
        enableSorting: false,
      },
      {
        id: 'deviceCount',
        accessorKey: 'deviceCount',
        header: 'Devices',
        cell: ({ row }) => <span className="tabular-nums">{row.original.deviceCount}</span>,
        enableSorting: false,
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <Button
            className="-ml-2.5"
            size="sm"
            variant="ghost"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === 'asc');
            }}
          >
            Created
            <ArrowUpDown />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {dateFormatter.format(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => <RowActions profile={row.original} />,
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [],
  );

  const { table } = useDataTable({
    data: rows,
    columns,
    pageCount,
    shallow: false,
    getRowId: (row) => row.id,
    initialState: { sorting: [{ id: 'createdAt', desc: true }] },
  });

  return (
    <DataTable className="min-h-0 flex-1" getItemValue={(row) => row.id} table={table}>
      <DataTableToolbar table={table}>
        <CreateProfileButton />
      </DataTableToolbar>
    </DataTable>
  );
};
