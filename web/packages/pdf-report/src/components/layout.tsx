import type { ReactElement } from 'react';

import { StyleSheet, Text, View } from '@react-pdf/renderer';

import { reportTheme } from './theme';
import {
  aggregate,
  filterRows,
  formatValue,
  stripEmoji,
  toArray,
  toNumber,
  type Aggregation,
  type CellFormat,
  type PathSpec,
  type Rule,
} from './utils';

import type { ComponentRenderProps } from './types';

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: reportTheme.border,
    borderLeftWidth: 3,
    borderLeftColor: reportTheme.brandTurquoise,
    backgroundColor: reportTheme.surfaceMuted,
  },
  sectionTitle: { fontSize: 12, fontWeight: 'bold', color: reportTheme.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: 9, color: reportTheme.textSubtle, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  card: {
    marginRight: '1%',
    marginBottom: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: reportTheme.border,
    backgroundColor: reportTheme.surface,
  },
  cardLabel: {
    fontSize: 8,
    color: reportTheme.textMuted,
    marginBottom: 3,
    textTransform: 'uppercase',
  },
  cardValue: { fontSize: 12, fontWeight: 'bold' },
  cardHint: { fontSize: 7, color: reportTheme.textMuted, marginTop: 2 },
});

const TONE_COLORS: Record<string, string> = {
  default: reportTheme.text,
  danger: reportTheme.danger,
  warning: reportTheme.warning,
  success: reportTheme.success,
  accent: reportTheme.brandAccent,
};

type SectionProps = {
  title?: string | null;
  subtitle?: string | null;
  backgroundColor?: string | null;
  borderColor?: string | null;
};

/** A titled card that groups report content, matching the console's panel look. */
export const Section = ({
  element,
  children,
}: ComponentRenderProps<SectionProps>): ReactElement => {
  const { props } = element;
  return (
    <View
      style={[
        styles.section,
        {
          backgroundColor: props.backgroundColor ?? reportTheme.surfaceMuted,
          borderColor: props.borderColor ?? reportTheme.border,
          borderLeftColor: reportTheme.brandTurquoise,
        },
      ]}
    >
      {props.title === undefined || props.title === null ? null : (
        <Text style={styles.sectionTitle}>{stripEmoji(props.title)}</Text>
      )}
      {props.subtitle === undefined || props.subtitle === null ? null : (
        <Text style={styles.sectionSubtitle}>{stripEmoji(props.subtitle)}</Text>
      )}
      {children}
    </View>
  );
};

/** Lays its `MetricCard` children out in an evenly-sized responsive grid. */
export const MetricGrid = ({ children }: ComponentRenderProps): ReactElement => (
  <View style={styles.grid}>{children}</View>
);

type MetricCardProps = {
  label: string;
  /** Literal value, or omit and use `data` + `agg` to compute one. */
  value?: unknown;
  data?: unknown;
  agg?: Aggregation | null;
  path?: PathSpec | PathSpec[] | null;
  /** Adds several fields together per row before aggregating, e.g. every error counter. */
  sumOf?: PathSpec[] | null;
  /** Restricts the rows the aggregation sees. */
  where?: Rule | Rule[] | null;
  /** Multiplies numeric values, e.g. 0.001 to convert ms to seconds. */
  scale?: number | null;
  /** Subtracted from `path` before aggregating, e.g. lastSeen - firstSeen. */
  minus?: PathSpec | PathSpec[] | null;
  format?: CellFormat | null;
  digits?: number | null;
  timeZone?: string | null;
  tone?: 'default' | 'danger' | 'warning' | 'success' | 'accent' | null;
  /** Turns the tone on only when the numeric value exceeds this threshold. */
  toneWhenAbove?: number | null;
  hint?: string | null;
  width?: string | null;
};

/**
 * A KPI tile. The value is either passed directly or computed from a raw array
 * (`data` + `agg` + optional `path`), so summary numbers need no pre-processing.
 */
export const MetricCard = ({ element }: ComponentRenderProps<MetricCardProps>): ReactElement => {
  const { props } = element;

  const computed =
    props.agg === undefined || props.agg === null
      ? props.value
      : aggregate(filterRows(toArray(props.data), props.where), props.agg, {
          path: props.path ?? undefined,
          sumOf: props.sumOf ?? undefined,
          scale: props.scale ?? undefined,
          minus: props.minus ?? undefined,
        });

  const display = formatValue(computed, props.format ?? 'text', {
    digits: props.digits ?? undefined,
    timeZone: props.timeZone ?? undefined,
  });

  const numeric = toNumber(computed);
  const threshold = props.toneWhenAbove ?? null;
  const toneActive = threshold === null ? true : numeric !== undefined && numeric > threshold;
  const color = toneActive
    ? (TONE_COLORS[props.tone ?? 'default'] ?? reportTheme.text)
    : reportTheme.text;

  return (
    <View style={[styles.card, { width: props.width ?? '32.3%' }]}>
      <Text style={styles.cardLabel}>{stripEmoji(props.label)}</Text>
      <Text style={[styles.cardValue, { color }]}>{display}</Text>
      {props.hint === undefined || props.hint === null ? null : (
        <Text style={styles.cardHint}>{stripEmoji(props.hint)}</Text>
      )}
    </View>
  );
};

type KeepTogetherProps = {
  gap?: number | null;
  padding?: number | null;
  marginTop?: number | null;
  marginBottom?: number | null;
  backgroundColor?: string | null;
  borderColor?: string | null;
  borderWidth?: number | null;
};

/** Prevents its children from being split across a page boundary. */
export const KeepTogether = ({
  element,
  children,
}: ComponentRenderProps<KeepTogetherProps>): ReactElement => {
  const { props } = element;
  return (
    <View
      style={{
        gap: props.gap ?? undefined,
        padding: props.padding ?? undefined,
        marginTop: props.marginTop ?? undefined,
        marginBottom: props.marginBottom ?? undefined,
        backgroundColor: props.backgroundColor ?? undefined,
        borderColor: props.borderColor ?? undefined,
        borderWidth: props.borderWidth ?? undefined,
      }}
      wrap={false}
    >
      {children}
    </View>
  );
};
