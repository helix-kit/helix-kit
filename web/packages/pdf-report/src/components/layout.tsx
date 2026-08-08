import type { ReactElement } from 'react';

import { StyleSheet, Text, View } from '@react-pdf/renderer';

import { reportTheme } from './theme';
import { aggregate, filterRows, formatValue, stripEmoji, toArray, toNumber } from './utils';

import type { KeepTogetherProps, MetricCardProps, SectionProps } from '../catalog';
import type { RenderProps } from './types';

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

/** A titled card that groups report content, matching the console's panel look. */
export const Section = ({ props, children }: RenderProps<SectionProps>): ReactElement => {
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
export const MetricGrid = ({ children }: RenderProps<Record<string, unknown>>): ReactElement => (
  <View style={styles.grid}>{children}</View>
);

/**
 * A KPI tile. The value is either passed directly or computed from a raw array
 * (`data` + `agg` + optional `path`), so summary numbers need no pre-processing.
 */
export const MetricCard = ({ props }: RenderProps<MetricCardProps>): ReactElement => {
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

/** Prevents its children from being split across a page boundary. */
export const KeepTogether = ({ props, children }: RenderProps<KeepTogetherProps>): ReactElement => {
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
