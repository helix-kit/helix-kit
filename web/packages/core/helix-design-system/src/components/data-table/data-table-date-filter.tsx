'use client';

import * as React from 'react';

import { CalendarIcon, XCircle } from 'lucide-react';

import { formatDate } from './format';

import type { Column } from '@tanstack/react-table';
import type { DateRange } from 'react-day-picker';

import { Button } from '../button';
import { Calendar } from '../calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { Separator } from '../separator';

type DateSelection = Date[] | DateRange;

const getIsDateRange = (value: DateSelection): value is DateRange =>
  typeof value === 'object' && !Array.isArray(value);

const parseAsDate = (timestamp: number | string | undefined): Date | undefined => {
  if (timestamp === undefined) {
    return undefined;
  }
  const numericTimestamp = typeof timestamp === 'string' ? Number(timestamp) : timestamp;
  const date = new Date(numericTimestamp);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const parseColumnFilterValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'number' || typeof item === 'string') {
        return item;
      }
      return undefined;
    });
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return [value];
  }

  return [];
};

interface DataTableDateFilterProps<TData> {
  column: Column<TData, unknown>;
  title?: string;
  multiple?: boolean;
}

/**
 * Single-date or date-range filter backed by timestamp values in the table
 * filter state.
 *
 * Single mode stores one millisecond timestamp; range mode stores a two-item
 * `[from, to]` tuple where either edge may be undefined.
 */
export const DataTableDateFilter = <TData,>({
  column,
  title,
  multiple,
}: DataTableDateFilterProps<TData>) => {
  const columnFilterValue = column.getFilterValue();

  const selectedDates = React.useMemo<DateSelection>(() => {
    if (columnFilterValue === undefined || columnFilterValue === null) {
      return multiple === true ? { from: undefined, to: undefined } : [];
    }

    if (multiple === true) {
      const timestamps = parseColumnFilterValue(columnFilterValue);
      return {
        from: parseAsDate(timestamps[0]),
        to: parseAsDate(timestamps[1]),
      };
    }

    const timestamps = parseColumnFilterValue(columnFilterValue);
    const date = parseAsDate(timestamps[0]);
    return date === undefined ? [] : [date];
  }, [columnFilterValue, multiple]);

  const onSelect = React.useCallback(
    (date: Date | DateRange | undefined) => {
      if (date === undefined) {
        column.setFilterValue(undefined);
        return;
      }

      if (multiple === true && !('getTime' in date)) {
        const from = date.from?.getTime();
        const to = date.to?.getTime();
        column.setFilterValue(from !== undefined || to !== undefined ? [from, to] : undefined);
      } else if (multiple !== true && 'getTime' in date) {
        column.setFilterValue(date.getTime());
      }
    },
    [column, multiple],
  );

  const onReset = React.useCallback(
    (event: React.SyntheticEvent) => {
      event.stopPropagation();
      column.setFilterValue(undefined);
    },
    [column],
  );

  const onResetKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onReset(event);
      }
    },
    [onReset],
  );

  const hasValue = React.useMemo(() => {
    if (multiple === true) {
      if (!getIsDateRange(selectedDates)) {
        return false;
      }
      return selectedDates.from !== undefined || selectedDates.to !== undefined;
    }
    if (!Array.isArray(selectedDates)) {
      return false;
    }
    return selectedDates.length > 0;
  }, [multiple, selectedDates]);

  const formatDateRange = React.useCallback((range: DateRange) => {
    if (range.from === undefined && range.to === undefined) {
      return '';
    }
    if (range.from !== undefined && range.to !== undefined) {
      return `${formatDate(range.from)} - ${formatDate(range.to)}`;
    }
    return formatDate(range.from ?? range.to);
  }, []);

  const label = React.useMemo(() => {
    if (multiple === true) {
      if (!getIsDateRange(selectedDates)) {
        return null;
      }

      const hasSelectedDates = selectedDates.from ?? selectedDates.to;
      const dateText =
        hasSelectedDates === undefined ? 'Select date range' : formatDateRange(selectedDates);

      return (
        <span className="flex items-center gap-2">
          <span>{title}</span>
          {hasSelectedDates !== undefined && (
            <>
              <Separator
                className="mx-0.5 data-[orientation=vertical]:h-4"
                orientation="vertical"
              />
              <span>{dateText}</span>
            </>
          )}
        </span>
      );
    }

    if (getIsDateRange(selectedDates)) {
      return null;
    }

    const hasSelectedDate = selectedDates.length > 0;
    const dateText = hasSelectedDate ? formatDate(selectedDates[0]) : 'Select date';

    return (
      <span className="flex items-center gap-2">
        <span>{title}</span>
        {hasSelectedDate ? (
          <>
            <Separator className="mx-0.5 data-[orientation=vertical]:h-4" orientation="vertical" />
            <span>{dateText}</span>
          </>
        ) : null}
      </span>
    );
  }, [selectedDates, multiple, formatDateRange, title]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="border-dashed" size="sm" variant="outline">
          {hasValue ? (
            <div
              aria-label={`Clear ${title} filter`}
              className="focus-visible:ring-ring rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-1 focus-visible:outline-none"
              role="button"
              tabIndex={0}
              onClick={onReset}
              onKeyDown={onResetKeyDown}
            >
              <XCircle />
            </div>
          ) : (
            <CalendarIcon />
          )}
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        {multiple === true ? (
          <Calendar
            mode="range"
            selected={
              getIsDateRange(selectedDates) ? selectedDates : { from: undefined, to: undefined }
            }
            onSelect={onSelect}
          />
        ) : (
          <Calendar
            mode="single"
            selected={getIsDateRange(selectedDates) ? undefined : selectedDates[0]}
            onSelect={onSelect}
          />
        )}
      </PopoverContent>
    </Popover>
  );
};
