import type { ReactElement } from 'react';

import { StyleSheet, Text, View } from '@react-pdf/renderer';

import { displayable } from './text';
import { reportTheme } from './theme';

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

/** A titled panel that groups report content. */
export const Section = ({ props, children }: RenderProps<SectionProps>): ReactElement => (
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
      <Text style={styles.sectionTitle}>{displayable(props.title)}</Text>
    )}
    {props.subtitle === undefined || props.subtitle === null ? null : (
      <Text style={styles.sectionSubtitle}>{displayable(props.subtitle)}</Text>
    )}
    {children}
  </View>
);

/** Lays its `MetricCard` children out in an evenly sized grid. */
export const MetricGrid = ({ children }: RenderProps<Record<string, never>>): ReactElement => (
  <View style={styles.grid}>{children}</View>
);

/** A KPI tile. `value` is already formatted, so it is drawn as given. */
export const MetricCard = ({ props }: RenderProps<MetricCardProps>): ReactElement => (
  <View style={[styles.card, { width: props.width ?? '32.3%' }]}>
    <Text style={styles.cardLabel}>{displayable(props.label)}</Text>
    <Text style={[styles.cardValue, { color: TONE_COLORS[props.tone ?? 'default'] }]}>
      {displayable(props.value)}
    </Text>
    {props.hint === undefined || props.hint === null ? null : (
      <Text style={styles.cardHint}>{displayable(props.hint)}</Text>
    )}
  </View>
);

/** Prevents its children from being split across a page boundary. */
export const KeepTogether = ({ props, children }: RenderProps<KeepTogetherProps>): ReactElement => (
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
