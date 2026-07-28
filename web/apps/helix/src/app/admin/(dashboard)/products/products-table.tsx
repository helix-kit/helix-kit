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

type ProductRow = inferRouterOutputs<AppRouter>['releases']['products']['list']['rows'][number];

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const lineHref = (row: ProductRow): string =>
  `/admin/products/${encodeURIComponent(row.typeKey)}/${encodeURIComponent(row.name)}`;

export const ProductsTable = ({
  rows,
  pageCount,
  types,
}: {
  rows: ProductRow[];
  pageCount: number;
  types: { key: string; displayName: string }[];
}) => {
  const columns = useMemo<ColumnDef<ProductRow>[]>(
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
          <Link className="font-medium hover:underline" href={lineHref(row.original)}>
            {row.original.name}
          </Link>
        ),
        enableColumnFilter: true,
        meta: { label: 'Name', variant: 'text', placeholder: 'Filter names...' },
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
        id: 'releaseCount',
        accessorKey: 'releaseCount',
        header: ({ column }) => (
          <Button
            className="-ml-2.5"
            size="sm"
            variant="ghost"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === 'asc');
            }}
          >
            Releases
            <ArrowUpDown />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.releaseCount}
            {row.original.draftCount > 0 ? (
              <span className="text-muted-foreground text-xs">
                {' '}
                ({row.original.draftCount} draft)
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'channels',
        accessorKey: 'channels',
        header: 'Channels',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.channels.map((channel) => (
              <Badge key={channel} className="font-normal" variant="secondary">
                {channel}
              </Badge>
            ))}
          </div>
        ),
        enableSorting: false,
      },
      {
        id: 'latestVersion',
        accessorKey: 'latestVersion',
        header: 'Latest',
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.latestVersion}</span>,
        enableSorting: false,
      },
      {
        id: 'latestCreatedAt',
        accessorKey: 'latestCreatedAt',
        header: ({ column }) => (
          <Button
            className="-ml-2.5"
            size="sm"
            variant="ghost"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === 'asc');
            }}
          >
            Updated
            <ArrowUpDown />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {dateFormatter.format(row.original.latestCreatedAt)}
          </span>
        ),
      },
    ],
    [types],
  );

  const { table } = useDataTable({
    data: rows,
    columns,
    pageCount,
    shallow: false,
    getRowId: (row) => `${row.typeKey}/${row.name}`,
    initialState: { sorting: [{ id: 'latestCreatedAt', desc: true }] },
  });

  return (
    <DataTable
      className="min-h-0 flex-1"
      getItemValue={(row) => `${row.typeKey}/${row.name}`}
      table={table}
    >
      <DataTableToolbar table={table} />
    </DataTable>
  );
};
