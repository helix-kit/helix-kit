import type * as React from 'react';

import { flexRender, type Row, type Table as TanstackTable } from '@tanstack/react-table';

import { DataTablePagination } from './data-table-pagination';

import { getCommonPinningStyles } from '../../lib/data-table';
import { cn } from '../../lib/utils';
import { ScrollArea } from '../scroll-area';
import { Sortable, SortableContent, SortableItem, SortableOverlay } from '../sortable';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../table';

type DataTableProps<TData extends object> = React.ComponentProps<'div'> & {
  table: TanstackTable<TData>;
  actionBar?: React.ReactNode;
  onValueChange?: (items: Row<TData>[]) => void;
  getItemValue: (item: TData) => string;
  enablePagination?: boolean;
  showBorder?: boolean;
  background?: boolean;
};

/** Shared Fluxery table shell for a TanStack table instance; `getItemValue` must return a stable id when drag-reordering. */
export const DataTable = <TData extends object>({
  table,
  actionBar,
  children,
  className,
  onValueChange,
  getItemValue,
  enablePagination = true,
  showBorder = true,
  background = true,
  ...props
}: DataTableProps<TData>) => {
  const { rows } = table.getRowModel();
  const hasRows = rows.length > 0;
  const hasSelectedRows = table.getFilteredSelectedRowModel().rows.length > 0;

  return (
    <div className={cn('flex min-h-0 w-full flex-col gap-2.5', className)} {...props}>
      {children}
      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className={cn('h-full w-full rounded-md', showBorder && 'border')}>
          <Sortable
            getItemValue={(item) => getItemValue(item.original)}
            value={rows}
            onValueChange={onValueChange}
          >
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className={cn('sticky top-0 z-10', background && 'bg-background')}
                        colSpan={header.colSpan}
                        style={{
                          ...getCommonPinningStyles({ column: header.column, withBorder: true }),
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <SortableContent asChild>
                <TableBody>
                  {hasRows ? (
                    rows.map((row) => (
                      <SortableItem
                        key={getItemValue(row.original)}
                        asChild
                        value={getItemValue(row.original)}
                      >
                        <TableRow data-state={row.getIsSelected() && 'selected'}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell
                              key={cell.id}
                              className={cn('h-10 py-1', background && 'bg-background')}
                              style={{
                                ...getCommonPinningStyles({
                                  column: cell.column,
                                  withBorder: true,
                                }),
                              }}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      </SortableItem>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        className="h-24 text-center"
                        colSpan={table.getAllColumns().length}
                      >
                        No results.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </SortableContent>
            </Table>
            <SortableOverlay>
              <div className="bg-primary/10 size-full rounded-md" />
            </SortableOverlay>
          </Sortable>
        </ScrollArea>
      </div>
      <div className="flex flex-col gap-2.5">
        {enablePagination === true && <DataTablePagination table={table} />}
        {actionBar !== undefined && hasSelectedRows ? actionBar : null}
      </div>
    </div>
  );
};
