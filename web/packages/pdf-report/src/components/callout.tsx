import type { ReactElement } from 'react';

import { StyleSheet, Text, View } from '@react-pdf/renderer';

import { reportTheme } from './theme';
import { filterRows, stripEmoji, toArray, type Rule } from './utils';

import type { ComponentRenderProps } from './types';

const styles = StyleSheet.create({
  callout: {
    marginTop: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderLeftWidth: 3,
    borderStyle: 'solid',
  },
  text: { fontSize: 8 },
});

const FALLBACK_TONE = {
  fill: reportTheme.surfaceMuted,
  accent: reportTheme.brandAccent,
  text: reportTheme.text,
};

const TONES: Record<string, { fill: string; accent: string; text: string }> = {
  info: FALLBACK_TONE,
  warning: { fill: reportTheme.warningFill, accent: reportTheme.warning, text: reportTheme.text },
  danger: { fill: reportTheme.dangerFill, accent: reportTheme.danger, text: reportTheme.text },
  success: { fill: reportTheme.successFill, accent: reportTheme.success, text: reportTheme.text },
};

type CalloutProps = {
  /** Message body. `{count}` is replaced with the number of matching rows. */
  text?: string;
  tone?: 'info' | 'warning' | 'danger' | 'success' | null;
  /** Rows the `where` rules are counted over. */
  data?: unknown;
  where?: Rule | Rule[] | null;
  /** Hides the whole callout when nothing matches (the usual case for warnings). */
  hideWhenEmpty?: boolean | null;
};

/**
 * A conditional note — e.g. "N devices reported an un-synced clock".
 *
 * Data-quality caveats belong in the report, but only when they apply, so the
 * component counts matching rows itself and removes itself when there are none.
 */
export const Callout = ({ element }: ComponentRenderProps<CalloutProps>): ReactElement | null => {
  const { props } = element;
  const text = props.text ?? '';
  if (text === '') {
    return null;
  }

  const count = filterRows(toArray(props.data), props.where).length;
  const hasData = Array.isArray(props.data);
  if (hasData && count === 0 && (props.hideWhenEmpty ?? true)) {
    return null;
  }

  const tone = TONES[props.tone ?? 'info'] ?? FALLBACK_TONE;

  return (
    <View style={[styles.callout, { backgroundColor: tone.fill, borderLeftColor: tone.accent }]}>
      <Text style={[styles.text, { color: tone.text }]}>
        {stripEmoji(text.replaceAll('{count}', String(count)))}
      </Text>
    </View>
  );
};
