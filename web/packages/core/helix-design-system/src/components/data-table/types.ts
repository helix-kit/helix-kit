import type { DataTableConfig } from './config';
import type { FilterItemSchema } from './parsers';
import type { ColumnSort, RowData } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Human-readable label shown in filter UIs and column controls. */
    label?: string;
    /** Placeholder text for text-based filter inputs. */
    placeholder?: string;
    /** Chooses which built-in filter control should render for the column. */
    variant?: FilterVariant;
    /** Enumerated values for select and multiselect filter variants. */
    options?: Option[];
    /** Inclusive numeric range used by slider/range filters. */
    range?: [number, number];
    /** Unit label appended to numeric filter controls. */
    unit?: string;
    /** Optional icon rendered alongside the column label in filter menus. */
    icon?: React.FC<React.SVGProps<SVGSVGElement>>;
  }
}

/** Option metadata consumed by select-like data-table filter components. */
export interface Option {
  label: string;
  value: string;
  count?: number;
  icon?: React.FC<React.SVGProps<SVGSVGElement>>;
}

/** Supported built-in filter control variants for a table column. */
export type FilterVariant = DataTableConfig['filterVariants'][number];

/** Sorting item whose `id` is restricted to keys from the current row shape. */
export interface ExtendedColumnSort<TData> extends Omit<ColumnSort, 'id'> {
  id: Extract<keyof TData, string>;
}

/** Parsed filter item whose `id` is restricted to keys from the current row shape. */
export interface ExtendedColumnFilter<TData> extends FilterItemSchema {
  id: Extract<keyof TData, string>;
}
