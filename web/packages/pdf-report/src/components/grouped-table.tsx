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
  groupRows,
  renderTemplate,
  stripEmoji,
  toArray,
  type Aggregation,
  type CellFormat,
  type PathSpec,
  type Rule,
} from './utils';

import type { ComponentRenderProps } from './types';

type GroupedColumn = {
  header: string;
  /**
   * `group` renders the bucket's own label; every other column aggregates the
   * rows inside the bucket.
   */
  type?: 'group' | 'value' | null;
  agg?: Aggregation | null;
  path?: PathSpec | PathSpec[] | null;
  /** Adds several fields together per row before aggregating. */
  sumOf?: PathSpec[] | null;
  scale?: number | null;
  minus?: PathSpec | PathSpec[] | null;
  format?: CellFormat | null;
  digits?: number | null;
  width?: string | null;
  align?: 'left' | 'center' | 'right' | null;
  /** Tints this cell when its value exceeds the threshold, e.g. faults above 0. */
  highlightAbove?: number | null;
  highlightColor?: string | null;
};

type GroupedTableProps = {
  /** Raw array of objects — e.g. a device-event query's output. */
  data?: unknown;
  /** Dot-path whose distinct values become one row each. */
  groupBy?: string;
  /**
   * Row label built from the bucket's first row, e.g. "{profile} / {firmware}".
   * Defaults to the grouped value itself.
   */
  labelTemplate?: string | null;
  columns?: GroupedColumn[];
  where?: Rule | Rule[] | null;
  /** Index of the column to order by; defaults to source order. */
  sortByColumn?: number | null;
  sortDir?: 'asc' | 'desc' | null;
  fontSize?: number | null;
  emptyText?: string | null;
  maxRows?: number | null;
};

// The bucket's own label: the grouped value, or a template filled from its first row.
const groupLabel = (
  bucket: { key: string; rows: unknown[] },
  template: string | null | undefined,
): string =>
  template === undefined || template === null
    ? bucket.key
    : renderTemplate(bucket.rows[0], template);

/**
 * One row per distinct value of `groupBy`, with each column aggregated over the
 * rows in that bucket.
 *
 * This is the "roll these events up per device / per profile / per firmware"
 * table. `DataTable` maps rows one-to-one, so without this a grouped summary
 * would have to be pre-aggregated by the caller — which is exactly what
 * templated reports exist to avoid.
 */
export const GroupedTable = ({
  element,
}: ComponentRenderProps<GroupedTableProps>): ReactElement | null => {
  const { props } = element;
  const columns = props.columns ?? [];
  const { groupBy } = props;
  const fontSize = props.fontSize ?? 9;

  if (columns.length === 0 || groupBy === undefined || groupBy === '') {
    return null;
  }

  const buckets = groupRows(filterRows(toArray(props.data), props.where), groupBy);

  const valueOf = (bucketRows: unknown[], column: GroupedColumn): number | undefined =>
    aggregate(bucketRows, column.agg ?? 'count', {
      path: column.path ?? undefined,
      sumOf: column.sumOf ?? undefined,
      scale: column.scale ?? undefined,
      minus: column.minus ?? undefined,
    });

  const sortColumn =
    props.sortByColumn === undefined || props.sortByColumn === null
      ? undefined
      : columns[props.sortByColumn];
  const ordered =
    sortColumn === undefined
      ? buckets
      : [...buckets].sort((left, right) => {
          const delta =
            (valueOf(left.rows, sortColumn) ?? 0) - (valueOf(right.rows, sortColumn) ?? 0);
          return props.sortDir === 'asc' ? delta : -delta;
        });

  const maxRows = props.maxRows ?? null;
  const rows = maxRows === null || maxRows <= 0 ? ordered : ordered.slice(0, maxRows);

  if (rows.length === 0) {
    return (
      <Text style={tableStyles.emptyText}>{props.emptyText ?? 'No data for this period.'}</Text>
    );
  }

  const defaultWidth = `${100 / columns.length}%`;

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

      {rows.map((bucket, rowIndex) => (
        <View key={`row-${rowIndex}`} style={tableStyles.row} wrap={false}>
          {columns.map((column, columnIndex) => {
            const isLabel = (column.type ?? 'value') === 'group';
            const numeric = isLabel ? undefined : valueOf(bucket.rows, column);
            const threshold = column.highlightAbove ?? null;
            const highlighted = threshold !== null && numeric !== undefined && numeric > threshold;

            const text = isLabel
              ? groupLabel(bucket, props.labelTemplate)
              : formatValue(numeric ?? 0, column.format ?? 'integer', {
                  digits: column.digits ?? undefined,
                });

            return (
              <View
                key={`cell-${rowIndex}-${columnIndex}`}
                style={[
                  tableStyles.cell,
                  columnIndex === 0 ? tableStyles.firstCell : {},
                  {
                    width: column.width ?? defaultWidth,
                    backgroundColor: highlighted
                      ? (column.highlightColor ?? reportTheme.dangerFill)
                      : reportTheme.surface,
                  },
                ]}
              >
                <Text style={{ fontSize, textAlign: column.align ?? 'left' }}>
                  {stripEmoji(text)}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
};
