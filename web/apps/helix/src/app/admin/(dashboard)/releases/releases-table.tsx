'use client';

import { useMemo } from 'react';

import Link from 'next/link';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import { DataTable } from '@helix/design-system/components/data-table';
import { DataTableToolbar } from '@helix/design-system/components/data-table/data-table-toolbar';
import { useDataTable } from '@helix/design-system/hooks/use-data-table';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown } from 'lucide-react';

import type { AppRouter } from '@/server/trpc';

import type { inferRouterOutputs } from '@trpc/server';

type ReleaseRow = inferRouterOutputs<AppRouter>['releases']['list']['rows'][number];

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const sortableHeader =
  (label: string) =>
  // eslint-disable-next-line react/display-name
  ({
    column,
  }: {
    column: { toggleSorting: (desc: boolean) => void; getIsSorted: () => unknown };
  }) => (
    <Button
      className="-ml-2.5"
      size="sm"
      variant="ghost"
      onClick={() => {
        column.toggleSorting(column.getIsSorted() === 'asc');
      }}
    >
      {label}
      <ArrowUpDown />
    </Button>
  );

export const ReleasesTable = ({
  rows,
  pageCount,
  types,
  channels,
  scope = 'all',
}: {
  rows: ReleaseRow[];
  pageCount: number;
  types: { key: string; displayName: string }[];
  channels: string[];
  // 'line' scope drops the Name + Type columns (constant within a product line)
  // and promotes Version to the link into the release detail.
  scope?: 'all' | 'line';
}) => {
  const columns = useMemo<ColumnDef<ReleaseRow>[]>(() => {
    const all: ColumnDef<ReleaseRow>[] = [
      {
        id: 'name',
        accessorKey: 'name',
        header: sortableHeader('Name'),
        cell: ({ row }) => (
          <Link className="font-medium hover:underline" href={`/admin/releases/${row.original.id}`}>
            {row.original.name}
          </Link>
        ),
        enableColumnFilter: true,
        meta: { label: 'Name', variant: 'text', placeholder: 'Filter names...' },
      },
      {
        id: 'version',
        accessorKey: 'version',
        header: sortableHeader('Version'),
        cell: ({ row }) =>
          scope === 'line' ? (
            <Link
              className="font-mono text-xs font-medium hover:underline"
              href={`/admin/releases/${row.original.id}`}
            >
              {row.original.version}
            </Link>
          ) : (
            <span className="font-mono text-xs">{row.original.version}</span>
          ),
      },
      {
        id: 'typeKey',
        accessorKey: 'typeKey',
        header: 'Type',
        cell: ({ row }) => {
          const type = types.find((item) => item.key === row.original.typeKey);
          return <span className="text-sm">{type?.displayName ?? row.original.typeKey}</span>;
        },
        enableSorting: false,
        enableColumnFilter: true,
        meta: {
          label: 'Type',
          variant: 'multiSelect',
          options: types.map((type) => ({ label: type.displayName, value: type.key })),
        },
      },
      {
        id: 'channel',
        accessorKey: 'channel',
        header: sortableHeader('Channel'),
        cell: ({ row }) => (
          <Badge className="font-normal" variant="secondary">
            {row.original.channel}
          </Badge>
        ),
        enableColumnFilter: true,
        meta: {
          label: 'Channel',
          variant: 'multiSelect',
          options: channels.map((channel) => ({ label: channel, value: channel })),
        },
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'ready' ? 'default' : 'outline'}>
            {row.original.status === 'ready' ? 'Ready' : 'Draft'}
          </Badge>
        ),
        enableSorting: false,
        enableColumnFilter: true,
        meta: {
          label: 'Status',
          variant: 'multiSelect',
          options: [
            { label: 'Ready', value: 'ready' },
            { label: 'Draft', value: 'draft' },
          ],
        },
      },
      {
        id: 'variantCount',
        accessorKey: 'variantCount',
        header: 'Variants',
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">{row.original.variantCount}</span>
        ),
        enableSorting: false,
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: sortableHeader('Created'),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {dateFormatter.format(row.original.createdAt)}
          </span>
        ),
      },
    ];
    return scope === 'line'
      ? all.filter((column) => column.id !== 'name' && column.id !== 'typeKey')
      : all;
  }, [types, channels, scope]);

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
      <DataTableToolbar table={table} />
    </DataTable>
  );
};
