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

type BuildRow = inferRouterOutputs<AppRouter>['releases']['builds']['list']['rows'][number];

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const HASH_PREFIX_LENGTH = 12;

const STATUS_VARIANT: Record<string, 'default' | 'destructive' | 'outline'> = {
  success: 'default',
  failed: 'destructive',
};

const formatDuration = (ms: number | null): string => {
  if (ms === null) {
    return '—';
  }
  const seconds = Math.round(ms / MS_PER_SECOND);
  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${seconds % SECONDS_PER_MINUTE}s`;
};

const statusVariant = (status: string): 'default' | 'destructive' | 'outline' =>
  STATUS_VARIANT[status] ?? 'outline';

export const BuildsTable = ({
  rows,
  pageCount,
  types,
}: {
  rows: BuildRow[];
  pageCount: number;
  types: { key: string; displayName: string }[];
}) => {
  const columns = useMemo<ColumnDef<BuildRow>[]>(
    () => [
      {
        id: 'status',
        accessorKey: 'status',
        header: ({ column }) => (
          <Button
            className="-ml-2.5"
            size="sm"
            variant="ghost"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === 'asc');
            }}
          >
            Status
            <ArrowUpDown />
          </Button>
        ),
        cell: ({ row }) => (
          <Badge variant={statusVariant(row.original.status)}>{row.original.status}</Badge>
        ),
        enableColumnFilter: true,
        meta: {
          label: 'Status',
          variant: 'multiSelect',
          options: [
            { label: 'Queued', value: 'queued' },
            { label: 'Success', value: 'success' },
            { label: 'Failed', value: 'failed' },
          ],
        },
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
        id: 'source',
        accessorKey: 'source',
        header: 'Source',
        cell: ({ row }) => (
          <Badge className="font-normal" variant="secondary">
            {row.original.source}
          </Badge>
        ),
        enableSorting: false,
        enableColumnFilter: true,
        meta: {
          label: 'Source',
          variant: 'multiSelect',
          options: [
            { label: 'CI', value: 'ci' },
            { label: 'Custom', value: 'custom' },
          ],
        },
      },
      {
        id: 'configHash',
        accessorKey: 'configHash',
        header: 'Config hash',
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.configHash.slice(0, HASH_PREFIX_LENGTH)}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: 'release',
        accessorKey: 'releaseId',
        header: 'Release',
        cell: ({ row }) =>
          row.original.releaseId === null ? (
            <span className="text-muted-foreground text-xs">—</span>
          ) : (
            <Link
              className="font-mono text-xs hover:underline"
              href={`/admin/releases/${row.original.releaseId}`}
            >
              {row.original.releaseId.slice(0, HASH_PREFIX_LENGTH)}
            </Link>
          ),
        enableSorting: false,
      },
      {
        id: 'durationMs',
        accessorKey: 'durationMs',
        header: ({ column }) => (
          <Button
            className="-ml-2.5"
            size="sm"
            variant="ghost"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === 'asc');
            }}
          >
            Duration
            <ArrowUpDown />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {formatDuration(row.original.durationMs)}
          </span>
        ),
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
    ],
    [types],
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
      <DataTableToolbar table={table} />
    </DataTable>
  );
};
