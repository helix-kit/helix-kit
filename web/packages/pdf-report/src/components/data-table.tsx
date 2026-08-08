/* eslint-disable no-magic-numbers -- padding/font sizes read best inline */
/* eslint-disable react/no-array-index-key -- static, non-reordered PDF rows */
import type { ReactElement } from 'react';

import { StyleSheet, Text, View } from '@react-pdf/renderer';

import { displayable } from './text';
import { reportTheme } from './theme';

import type { DataTableProps } from '../catalog';
import type { RenderProps } from './types';

const tableStyles = StyleSheet.create({
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

/**
 * A table of pre-formatted strings.
 *
 * Every cell arrives ready to draw. Sorting, filtering, grouping and formatting
 * happened in the code step, which is also what decides `rowColors` — so the
 * component has no rules to evaluate and no data to reshape.
 */
export const DataTable = ({ props }: RenderProps<DataTableProps>): ReactElement | null => {
  const { headers, rows } = props;

  if (headers.length === 0) {
    return null;
  }

  if (rows.length === 0) {
    return (
      <Text style={tableStyles.emptyText}>{props.emptyText ?? 'No data for this period.'}</Text>
    );
  }

  const fontSize = props.fontSize ?? 9;
  const borderColor = props.borderColor ?? reportTheme.borderSubtle;
  const striped = props.striped ?? false;
  const defaultWidth = `${100 / headers.length}%`;

  const widthOf = (column: number): string => props.columnWidths?.[column] ?? defaultWidth;
  const alignOf = (column: number) => props.align?.[column] ?? 'left';

  const backgroundOf = (row: number): string => {
    const explicit = props.rowColors?.[row];
    if (explicit !== undefined && explicit !== null) {
      return explicit;
    }
    return striped && row % 2 === 1 ? reportTheme.surfaceMuted : reportTheme.surface;
  };

  return (
    <View style={tableStyles.table}>
      <View style={tableStyles.row}>
        {headers.map((header, column) => (
          <View
            key={`header-${column}`}
            style={[
              tableStyles.cell,
              tableStyles.headerCell,
              column === 0 ? tableStyles.firstCell : {},
              {
                width: widthOf(column),
                borderColor,
                backgroundColor: props.headerBackgroundColor ?? reportTheme.headerFill,
              },
            ]}
          >
            <Text style={[tableStyles.headerText, { fontSize, textAlign: alignOf(column) }]}>
              {header}
            </Text>
          </View>
        ))}
      </View>

      {rows.map((cells, row) => (
        <View key={`row-${row}`} style={tableStyles.row} wrap={false}>
          {headers.map((_, column) => (
            <View
              key={`cell-${row}-${column}`}
              style={[
                tableStyles.cell,
                column === 0 ? tableStyles.firstCell : {},
                { width: widthOf(column), borderColor, backgroundColor: backgroundOf(row) },
              ]}
            >
              <Text style={{ fontSize, textAlign: alignOf(column) }}>
                {displayable(cells[column] ?? '')}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
};
