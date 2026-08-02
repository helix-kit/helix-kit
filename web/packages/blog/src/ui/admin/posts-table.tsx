'use client';

import { useMemo } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import { DataTable } from '@helix/design-system/components/data-table';
import { DataTableToolbar } from '@helix/design-system/components/data-table/data-table-toolbar';
import { DeleteConfirmDialog } from '@helix/design-system/components/delete-confirm-dialog';
import { TableActions } from '@helix/design-system/components/table-actions';
import { useDataTable } from '@helix/design-system/hooks/use-data-table';
import { useMutation } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { useBlogAdminApi } from './api';

import type { BlogAdminRouter } from '../../server/router';
import type { inferRouterOutputs } from '@trpc/server';

type PostRow = inferRouterOutputs<BlogAdminRouter>['list']['rows'][number];

const DEFAULT_BASE_PATH = '/admin/post';

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

const RowActions = ({ post, basePath }: { post: PostRow; basePath: string }) => {
  const router = useRouter();
  const api = useBlogAdminApi();
  const del = useMutation(
    api.delete.mutationOptions({
      onSuccess: () => {
        toast.success('Post deleted');
        router.refresh();
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  return (
    <TableActions>
      <Button asChild className="size-8" size="icon" variant="ghost">
        <Link aria-label="Edit post" href={`${basePath}/${post.id}`}>
          <Pencil />
        </Link>
      </Button>
      <DeleteConfirmDialog
        description={`This permanently deletes "${post.title}". This cannot be undone.`}
        isPending={del.isPending}
        title="Delete post?"
        trigger={
          <Button aria-label="Delete post" className="size-8" size="icon" variant="destructive">
            <Trash2 />
          </Button>
        }
        onConfirm={() => {
          del.mutate({ id: post.id });
        }}
      />
    </TableActions>
  );
};

export const PostsTable = ({
  rows,
  pageCount,
  basePath = DEFAULT_BASE_PATH,
}: {
  rows: PostRow[];
  pageCount: number;
  basePath?: string;
}) => {
  const columns = useMemo<ColumnDef<PostRow>[]>(
    () => [
      {
        id: 'title',
        accessorKey: 'title',
        header: ({ column }) => (
          <Button
            className="-ml-2.5"
            size="sm"
            variant="ghost"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === 'asc');
            }}
          >
            Title
            <ArrowUpDown />
          </Button>
        ),
        cell: ({ row }) => (
          <Link className="font-medium hover:underline" href={`${basePath}/${row.original.id}`}>
            {row.original.title}
          </Link>
        ),
        enableColumnFilter: true,
        meta: { label: 'Title', variant: 'text', placeholder: 'Filter titles...' },
      },
      {
        id: 'status',
        accessorKey: 'published',
        header: 'Status',
        cell: ({ row }) => (
          <Badge variant={row.original.published ? 'default' : 'outline'}>
            {row.original.published ? 'Published' : 'Draft'}
          </Badge>
        ),
        enableSorting: false,
        enableColumnFilter: true,
        meta: {
          label: 'Status',
          variant: 'multiSelect',
          options: [
            { label: 'Published', value: 'published' },
            { label: 'Draft', value: 'draft' },
          ],
        },
      },
      {
        id: 'slug',
        accessorKey: 'slug',
        header: 'Slug',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">{row.original.slug}</span>
        ),
        enableSorting: false,
      },
      {
        id: 'updatedAt',
        accessorKey: 'updatedAt',
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
            {dateFormatter.format(row.original.updatedAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => <RowActions basePath={basePath} post={row.original} />,
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [basePath],
  );

  // shallow:false re-runs the Server Component so rows + pageCount come from a fresh query.
  const { table } = useDataTable({
    data: rows,
    columns,
    pageCount,
    shallow: false,
    getRowId: (row) => row.id,
    initialState: { sorting: [{ id: 'updatedAt', desc: true }] },
  });

  return (
    <DataTable className="min-h-0 flex-1" getItemValue={(row) => row.id} table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
};
