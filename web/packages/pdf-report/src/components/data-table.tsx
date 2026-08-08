/* eslint-disable no-magic-numbers -- padding/font sizes read best inline */
/* eslint-disable react/no-array-index-key -- static, non-reordered PDF rows */
import type { ReactElement } from 'react';

import { Image, Link, StyleSheet, Text, View } from '@react-pdf/renderer';

import { reportTheme } from './theme';
import {
  filterRows,
  formatValue,
  matchesRule,
  renderTemplate,
  resolveValue,
  sortRows,
  stripEmoji,
  toArray,
} from './utils';

import type { CellFormat, DataTableProps, PathSpec, Rule } from '../catalog';
import type { RenderProps } from './types';

/** Shared by every tabular component so borders and header fills cannot drift. */
export const tableStyles = StyleSheet.create({
  table: { width: 'auto' },
  row: { flexDirection: 'row' },
  cell: {
    borderStyle: 'solid',
    borderColor: reportTheme.borderSubtle,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    paddingVertical: 4,
    paddingHorizontal: 5,
    justifyContent: 'center',
  },
  firstCell: { borderLeftWidth: 1 },
  headerCell: { borderTopWidth: 1, backgroundColor: reportTheme.headerFill },
  headerText: { fontWeight: 'bold', color: reportTheme.text },
  emptyText: { fontSize: 9, color: reportTheme.textMuted, paddingVertical: 8 },
});

type ColumnDefinition = {
  header: string;
  /**
   * `text` (default) renders the formatted value. `image` renders the value as
   * a picture and `link` as a clickable link — both expect the cell value to be
   * a URL, e.g. a signed URL for a device-captured frame.
   */
  type?: 'text' | 'image' | 'link' | null;
  /** Link text for `type: 'link'`; defaults to the column header. */
  linkLabel?: string | null;
  imageHeight?: number | null;
  imageWidth?: number | null;
  /** Dot-path into each row object, e.g. `payload.uptime`. A list coalesces the
   *  first path that has a value (handles payload variants). */
  path?: PathSpec | PathSpec[];
  /** Adds several fields together, e.g. every error counter. */
  sumOf?: PathSpec[] | null;
  /** Builds the cell from a `{dot.path}` string, e.g. "{profile} / {deviceId}". */
  template?: string | null;
  /**
   * First matching rule replaces the cell with its `text` — how a column shows a
   * flag ("stale?") for rows meeting a condition. Falls through to
   * `path`/`template`/`placeholder` when nothing matches.
   */
  rules?: ({ text: string } & Rule)[] | null;
  /** Multiplies numeric values, e.g. 0.001 to convert ms to seconds. */
  scale?: number | null;
  /** Subtracted from `path` before formatting, e.g. lastSeen - firstSeen. */
  minus?: PathSpec | PathSpec[] | null;
  width?: string | null;
  align?: 'left' | 'center' | 'right' | null;
  format?: CellFormat | null;
  digits?: number | null;
  /** IANA zone for `datetime`/`date` cells; defaults to UTC. */
  timeZone?: string | null;
  placeholder?: string | null;
};

type RowHighlightRule = Rule & { color: string };

const resolveRowColor = (
  row: unknown,
  rules: RowHighlightRule[] | null | undefined,
  index: number,
  striped: boolean,
): string | undefined => {
  for (const rule of rules ?? []) {
    if (matchesRule(row, rule)) {
      return rule.color;
    }
  }
  if (striped && index % 2 === 1) {
    return reportTheme.surfaceMuted;
  }
  return undefined;
};

// Renders one cell: a thumbnail, a link, or formatted text.
const renderCell = (row: unknown, column: ColumnDefinition, fontSize: number) => {
  const matched = (column.rules ?? []).find((rule) => matchesRule(row, rule));
  if (matched !== undefined) {
    return (
      <Text style={{ fontSize, textAlign: column.align ?? 'left' }}>
        {stripEmoji(matched.text)}
      </Text>
    );
  }

  if (column.template !== undefined && column.template !== null) {
    return (
      <Text style={{ fontSize, textAlign: column.align ?? 'left' }}>
        {stripEmoji(renderTemplate(row, column.template))}
      </Text>
    );
  }

  const raw = resolveValue(row, {
    path: column.path,
    sumOf: column.sumOf ?? undefined,
    minus: column.minus ?? undefined,
    scale: column.scale ?? undefined,
  });
  const kind = column.type ?? 'text';

  if (kind === 'image') {
    return typeof raw === 'string' && raw !== '' ? (
      <Image
        src={raw}
        style={{ height: column.imageHeight ?? 38, width: column.imageWidth ?? 54 }}
      />
    ) : (
      <Text style={{ fontSize, textAlign: column.align ?? 'center' }}>—</Text>
    );
  }

  if (kind === 'link') {
    return typeof raw === 'string' && raw !== '' ? (
      <Link
        src={raw}
        style={{ fontSize, textAlign: column.align ?? 'center', color: reportTheme.brandDeep }}
      >
        {stripEmoji(column.linkLabel ?? column.header)}
      </Link>
    ) : (
      <Text style={{ fontSize, textAlign: column.align ?? 'center' }}>—</Text>
    );
  }

  return (
    <Text style={{ fontSize, textAlign: column.align ?? 'left' }}>
      {stripEmoji(
        formatValue(raw, column.format ?? 'text', {
          digits: column.digits ?? undefined,
          placeholder: column.placeholder ?? undefined,
          timeZone: column.timeZone ?? undefined,
        }),
      )}
    </Text>
  );
};

/**
 * A table that binds directly to an array of objects with dot-path column
 * definitions, per-cell formatting and rule-based row tinting — so report
 * authors never have to pre-shape `string[][]` rows.
 */
export const DataTable = ({ props }: RenderProps<DataTableProps>): ReactElement | null => {
  const columns = props.columns ?? [];
  const allRows = sortRows(
    filterRows(toArray(props.data), props.where),
    props.sortBy === undefined || props.sortBy === null ? undefined : { path: props.sortBy },
    props.sortDir ?? 'asc',
  );
  const maxRows = props.maxRows ?? null;
  const rows = maxRows === null || maxRows <= 0 ? allRows : allRows.slice(0, maxRows);
  const fontSize = props.fontSize ?? 9;
  const borderColor = props.borderColor ?? reportTheme.borderSubtle;
  const striped = props.striped ?? false;

  if (columns.length === 0) {
    return null;
  }

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
              {
                width: column.width ?? defaultWidth,
                borderColor,
                backgroundColor: props.headerBackgroundColor ?? reportTheme.headerFill,
              },
            ]}
          >
            <Text style={[tableStyles.headerText, { fontSize, textAlign: column.align ?? 'left' }]}>
              {stripEmoji(column.header)}
            </Text>
          </View>
        ))}
      </View>

      {rows.map((row, rowIndex) => {
        const background = resolveRowColor(row, props.rowHighlight, rowIndex, striped);
        return (
          <View key={`row-${rowIndex}`} style={tableStyles.row} wrap={false}>
            {columns.map((column, columnIndex) => (
              <View
                key={`cell-${rowIndex}-${columnIndex}`}
                style={[
                  tableStyles.cell,
                  columnIndex === 0 ? tableStyles.firstCell : {},
                  {
                    width: column.width ?? defaultWidth,
                    borderColor,
                    backgroundColor: background ?? reportTheme.surface,
                  },
                ]}
              >
                {renderCell(row, column, fontSize)}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
};
