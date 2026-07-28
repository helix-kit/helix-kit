'use client';

import * as React from 'react';

import { Check, ChevronsUpDown, Settings2 } from 'lucide-react';

import type { Table } from '@tanstack/react-table';

import { cn } from '../../lib/utils';
import { Button } from '../button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../command';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';

interface DataTableViewOptionsProps<TData> {
  table: Table<TData>;
}

/**
 * Column-visibility menu for hideable TanStack columns.
 *
 * Only columns with an accessor and `getCanHide()` enabled are listed.
 */
export const DataTableViewOptions = <TData,>({ table }: DataTableViewOptionsProps<TData>) => {
  const columns = React.useMemo(
    () =>
      table
        .getAllColumns()
        .filter((column) => typeof column.accessorFn !== 'undefined' && column.getCanHide()),
    [table],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label="Toggle columns"
          className="ml-auto hidden h-8 lg:flex"
          size="sm"
          variant="outline"
        >
          <Settings2 />
          View
          <ChevronsUpDown className="ml-auto opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-0">
        <Command>
          <CommandInput placeholder="Search columns..." />
          <CommandList>
            <CommandEmpty>No columns found.</CommandEmpty>
            <CommandGroup>
              {columns.map((column) => (
                <CommandItem
                  key={column.id}
                  onSelect={() => {
                    column.toggleVisibility(!column.getIsVisible());
                  }}
                >
                  <span className="truncate">{column.columnDef.meta?.label ?? column.id}</span>
                  <Check
                    className={cn(
                      'ml-auto size-4 shrink-0',
                      column.getIsVisible() ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
