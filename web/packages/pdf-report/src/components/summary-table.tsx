/* eslint-disable no-magic-numbers -- padding/font sizes read best inline */
/* eslint-disable react/no-array-index-key -- static, non-reordered PDF rows */
import type { ReactElement } from 'react';

import { Text, View } from '@react-pdf/renderer';

import { tableStyles } from './data-table';
import { reportTheme } from './theme';
import {
  aggregate,
  filterRows,
  formatValue,
  stripEmoji,
  toArray,
  type Aggregation,
  type CellFormat,
  type PathSpec,
  type Rule,
} from './utils';

import type { ComponentRenderProps } from './types';

type ComputedCell = {
  /** Dot-path aggregated across every row of `data`. */
  path?: PathSpec | PathSpec[];
  /** Adds several fields together per row before aggregating. */
  sumOf?: PathSpec[];
  /** Restricts the rows this cell aggregates over. */
  where?: Rule | Rule[];
  agg?: Aggregation;
  scale?: number;
  minus?: PathSpec | PathSpec[];
  format?: CellFormat;
  digits?: number;
};

type SummaryCell = string | number | ComputedCell;

type SummaryTableProps = {
  /** The dataset every computed cell is aggregated over. */
  data?: unknown;
  columns?: { header: string; width?: string | null; align?: 'left' | 'center' | 'right' | null }[];
  rows?: { cells: SummaryCell[] }[];
  /** Tints a row when any of its computed cells aggregates above zero. */
  rowHighlightColor?: string | null;
  fontSize?: number | null;
};

const isComputed = (cell: SummaryCell): cell is ComputedCell => typeof cell === 'object';

/**
 * A transposed summary table: one row per *field* rather than per record, with
 * each cell aggregated across the whole dataset.
 *
 * This is what lets "summarise these N fields across all events" tables (error
 * counters, per-code totals) be expressed purely in a template, instead of being
 * pre-computed by the caller.
 */
export const SummaryTable = ({
  element,
}: ComponentRenderProps<SummaryTableProps>): ReactElement | null => {
  const { props } = element;
  const columns = props.columns ?? [];
  const rows = props.rows ?? [];
  const data = toArray(props.data);
  const fontSize = props.fontSize ?? 9;

  if (columns.length === 0 || rows.length === 0) {
    return null;
  }

  const defaultWidth = `${100 / columns.length}%`;

  const resolveCell = (cell: SummaryCell): { text: string; numeric: number | undefined } => {
    if (!isComputed(cell)) {
      return { text: String(cell), numeric: undefined };
    }
    const value = aggregate(filterRows(data, cell.where), cell.agg ?? 'sum', {
      path: cell.path,
      sumOf: cell.sumOf,
      scale: cell.scale,
      minus: cell.minus,
    });
    return {
      text: formatValue(value ?? 0, cell.format ?? 'integer', { digits: cell.digits }),
      numeric: value,
    };
  };

  return (
    <View style={tableStyles.table}>
      <View style={tableStyles.row}>
        {columns.map((column, columnIndex) => (
          <View
            key={`header-${columnIndex}`}
            style={[
              tableStyles.cell,
              tableStyles.headerCell,
              columnIndex === 0 ? tableStyles.firstCell : {},
              { width: column.width ?? defaultWidth },
            ]}
          >
            <Text style={[tableStyles.headerText, { fontSize, textAlign: column.align ?? 'left' }]}>
              {stripEmoji(column.header)}
            </Text>
          </View>
        ))}
      </View>

      {rows.map((row, rowIndex) => {
        const resolved = row.cells.map(resolveCell);
        const active = resolved.some((cell) => (cell.numeric ?? 0) > 0);
        const background =
          active && props.rowHighlightColor !== undefined && props.rowHighlightColor !== null
            ? props.rowHighlightColor
            : reportTheme.surface;

        return (
          <View key={`row-${rowIndex}`} style={tableStyles.row} wrap={false}>
            {columns.map((column, columnIndex) => (
              <View
                key={`cell-${rowIndex}-${columnIndex}`}
                style={[
                  tableStyles.cell,
                  columnIndex === 0 ? tableStyles.firstCell : {},
                  { width: column.width ?? defaultWidth, backgroundColor: background },
                ]}
              >
                <Text style={{ fontSize, textAlign: column.align ?? 'left' }}>
                  {stripEmoji(resolved[columnIndex]?.text ?? '—')}
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
};
