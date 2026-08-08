import type { ReactElement } from 'react';

import { StyleSheet, Text, View } from '@react-pdf/renderer';

import { displayable } from './text';
import { reportTheme } from './theme';

import type { CalloutProps } from '../catalog';
import type { RenderProps } from './types';

const styles = StyleSheet.create({
  callout: {
    marginTop: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderLeftWidth: 3,
    borderStyle: 'solid',
  },
  text: { fontSize: 8, color: reportTheme.text },
});

const FALLBACK = { fill: reportTheme.surfaceMuted, accent: reportTheme.brandAccent };

const TONES: Record<string, { fill: string; accent: string }> = {
  info: FALLBACK,
  warning: { fill: reportTheme.warningFill, accent: reportTheme.warning },
  danger: { fill: reportTheme.dangerFill, accent: reportTheme.danger },
  success: { fill: reportTheme.successFill, accent: reportTheme.success },
};

/**
 * A short highlighted note.
 *
 * Empty text renders nothing, which is how a template shows one conditionally:
 * the code emits the message or an empty string.
 */
export const Callout = ({ props }: RenderProps<CalloutProps>): ReactElement | null => {
  if (props.text === '') {
    return null;
  }

  const tone = TONES[props.tone ?? 'info'] ?? FALLBACK;

  return (
    <View style={[styles.callout, { backgroundColor: tone.fill, borderLeftColor: tone.accent }]}>
      <Text style={styles.text}>{displayable(props.text)}</Text>
    </View>
  );
};
