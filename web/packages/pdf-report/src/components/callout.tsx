import type { ReactElement } from 'react';

import { StyleSheet, Text, View } from '@react-pdf/renderer';

import { displayable } from './text';
import { reportTheme, type ReportPalette } from './theme';

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

// `info` borrows the caller's accent, so the map is built per render; the other
// three are semantic and stay fixed.
type Tone = { fill: string; accent: string };

const tones = (accent: string): Record<string, Tone> => ({
  info: { fill: reportTheme.surfaceMuted, accent: accent },
  warning: { fill: reportTheme.warningFill, accent: reportTheme.warning },
  danger: { fill: reportTheme.dangerFill, accent: reportTheme.danger },
  success: { fill: reportTheme.successFill, accent: reportTheme.success },
});

/**
 * A short highlighted note.
 *
 * Empty text renders nothing, which is how a template shows one conditionally:
 * the code emits the message or an empty string.
 */
export const Callout = (
  { props }: RenderProps<CalloutProps>,
  palette: ReportPalette,
): ReactElement | null => {
  if (props.text === '') {
    return null;
  }

  const byTone = tones(palette.accent);
  const info: Tone = { fill: reportTheme.surfaceMuted, accent: palette.accent };
  const tone = byTone[props.tone ?? 'info'] ?? info;

  return (
    <View style={[styles.callout, { backgroundColor: tone.fill, borderLeftColor: tone.accent }]}>
      <Text style={styles.text}>{displayable(props.text)}</Text>
    </View>
  );
};
