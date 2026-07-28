'use client';

import * as React from 'react';

import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type TableOptions,
  type TableState,
  type Updater,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  type UseQueryStateOptions,
  useQueryState,
  useQueryStates,
  type SingleParser,
} from 'nuqs';

import { useDebouncedCallback } from './use-debounced-callback';

import type { ExtendedColumnSort } from '../components/data-table/types';

import { getSortingStateParser } from '../components/data-table/parsers';

const PAGE_KEY = 'page';
const PER_PAGE_KEY = 'perPage';
const SORT_KEY = 'sort';
const ARRAY_SEPARATOR = ',';
const DEBOUNCE_MS = 300;
const THROTTLE_MS = 50;
const DEFAULT_PAGE_SIZE = 10;

const getColumnKey = <TData>(column: ColumnDef<TData>): string | null => {
  if (typeof column.id === 'string' && column.id !== '') {
    return column.id;
  }

  if (
    'accessorKey' in column &&
    typeof column.accessorKey === 'string' &&
    column.accessorKey !== ''
  ) {
    return column.accessorKey;
  }

  return null;
};

interface UseDataTableProps<TData>
  extends
    Omit<
      TableOptions<TData>,
      | 'state'
      | 'pageCount'
      | 'getCoreRowModel'
      | 'manualFiltering'
      | 'manualPagination'
      | 'manualSorting'
    >,
    Required<Pick<TableOptions<TData>, 'pageCount'>> {
  initialState?: Omit<Partial<TableState>, 'sorting'> & {
    sorting?: ExtendedColumnSort<TData>[];
  };
  history?: 'push' | 'replace';
  debounceMs?: number;
  throttleMs?: number;
  clearOnDefault?: boolean;
  enableAdvancedFilter?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  startTransition?: React.TransitionStartFunction;
}

/**
 * Builds a TanStack table instance whose pagination, sorting, and filter state
 * stay synchronized with the URL query string via `nuqs`.
 *
 * The returned table is configured for manual pagination, sorting, and
 * filtering so consumers can fetch server-backed rows from the current query
 * state. Filterable column ids should be stable because they are used as query
 * parameter keys.
 */
export const useDataTable = <TData>(props: UseDataTableProps<TData>) => {
  const {
    columns,
    pageCount = -1,
    initialState,
    history = 'replace',
    debounceMs = DEBOUNCE_MS,
    throttleMs = THROTTLE_MS,
    clearOnDefault = false,
    scroll = false,
    shallow = true,
    startTransition,
    ...tableProps
  } = props;

  const queryStateOptions = React.useMemo<Omit<UseQueryStateOptions<string>, 'parse'>>(
    () => ({
      history,
      scroll,
      shallow,
      throttleMs,
      debounceMs,
      clearOnDefault,
      startTransition,
    }),
    [history, scroll, shallow, throttleMs, debounceMs, clearOnDefault, startTransition],
  );

  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>(
    initialState?.rowSelection ?? {},
  );
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    initialState?.columnVisibility ?? {},
  );

  const [page, setPage] = useQueryState(
    PAGE_KEY,
    parseAsInteger.withOptions(queryStateOptions).withDefault(1),
  );
  const [perPage, setPerPage] = useQueryState(
    PER_PAGE_KEY,
    parseAsInteger
      .withOptions(queryStateOptions)
      .withDefault(initialState?.pagination?.pageSize ?? DEFAULT_PAGE_SIZE),
  );

  const pagination: PaginationState = React.useMemo(() => {
    return {
      pageIndex: page - 1,
      pageSize: perPage,
    };
  }, [page, perPage]);

  const onPaginationChange = React.useCallback(
    (updaterOrValue: Updater<PaginationState>) => {
      if (typeof updaterOrValue === 'function') {
        const newPagination = updaterOrValue(pagination);
        void setPage(newPagination.pageIndex + 1);
        void setPerPage(newPagination.pageSize);
      } else {
        void setPage(updaterOrValue.pageIndex + 1);
        void setPerPage(updaterOrValue.pageSize);
      }
    },
    [pagination, setPage, setPerPage],
  );

  const columnIds = React.useMemo(() => {
    return new Set(columns.map(getColumnKey).filter((key): key is string => key !== null));
  }, [columns]);

  const [sorting, setSorting] = useQueryState(
    SORT_KEY,
    getSortingStateParser<TData>(columnIds)
      .withOptions(queryStateOptions)
      .withDefault(initialState?.sorting ?? []),
  );

  const onSortingChange = React.useCallback(
    (updaterOrValue: Updater<SortingState>) => {
      if (typeof updaterOrValue === 'function') {
        const newSorting = updaterOrValue(sorting);
        void setSorting(newSorting as ExtendedColumnSort<TData>[]);
      } else {
        void setSorting(updaterOrValue as ExtendedColumnSort<TData>[]);
      }
    },
    [sorting, setSorting],
  );

  const filterableColumns = React.useMemo(() => {
    return columns.filter((column) => column.enableColumnFilter === true);
  }, [columns]);

  const filterableColumnKeys = React.useMemo(() => {
    return new Set(
      filterableColumns.map(getColumnKey).filter((key): key is string => key !== null),
    );
  }, [filterableColumns]);

  const filterParsers = React.useMemo(() => {
    return filterableColumns.reduce<Record<string, SingleParser<string> | SingleParser<string[]>>>(
      (acc, column) => {
        const columnKey = getColumnKey(column);
        if (columnKey === null) {
          return acc;
        }

        if (column.meta?.options === undefined) {
          acc[columnKey] = parseAsString.withOptions(queryStateOptions);
        } else {
          acc[columnKey] = parseAsArrayOf(parseAsString, ARRAY_SEPARATOR).withOptions(
            queryStateOptions,
          );
        }
        return acc;
      },
      {},
    );
  }, [filterableColumns, queryStateOptions]);

  const [filterValues, setFilterValues] = useQueryStates(filterParsers);

  const debouncedSetFilterValues = useDebouncedCallback((values: typeof filterValues) => {
    void setPage(1);
    void setFilterValues(values);
  }, debounceMs);

  const initialColumnFilters: ColumnFiltersState = React.useMemo(() => {
    return Object.entries(filterValues).reduce<ColumnFiltersState>((filters, [key, value]) => {
      if (value !== null) {
        let processedValue;

        if (Array.isArray(value)) {
          processedValue = value;
        } else if (typeof value === 'string' && /[^a-zA-Z0-9]/.test(value)) {
          processedValue = value.split(/[^a-zA-Z0-9]+/).filter(Boolean);
        } else {
          processedValue = [value];
        }

        filters.push({
          id: key,
          value: processedValue,
        });
      }
      return filters;
    }, []);
  }, [filterValues]);

  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>(initialColumnFilters);

  const isFilterableColumn = React.useCallback(
    (filterId: string) => {
      return filterableColumnKeys.has(filterId);
    },
    [filterableColumnKeys],
  );

  const processColumnFilters = React.useCallback(
    (prev: ColumnFiltersState, next: ColumnFiltersState) => {
      const filterUpdates: Record<string, string | string[] | null> = {};
      for (const filter of next) {
        if (filter.id !== '' && isFilterableColumn(filter.id)) {
          filterUpdates[filter.id] = filter.value as string | string[];
        }
      }
      for (const prevFilter of prev) {
        if (prevFilter.id !== '' && !next.some((filter) => filter.id === prevFilter.id)) {
          filterUpdates[prevFilter.id] = null;
        }
      }
      return { filterUpdates, next };
    },
    [isFilterableColumn],
  );

  const onColumnFiltersChange = React.useCallback(
    (updaterOrValue: Updater<ColumnFiltersState>) => {
      setColumnFilters((prev) => {
        const next = typeof updaterOrValue === 'function' ? updaterOrValue(prev) : updaterOrValue;
        const { filterUpdates, next: processedNext } = processColumnFilters(prev, next);
        debouncedSetFilterValues(filterUpdates);
        return processedNext;
      });
    },
    [debouncedSetFilterValues, processColumnFilters],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    ...tableProps,
    columns,
    initialState,
    pageCount,
    state: {
      pagination,
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
    },
    defaultColumn: {
      ...tableProps.defaultColumn,
      enableColumnFilter: false,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  return { table, shallow, debounceMs, throttleMs };
};
