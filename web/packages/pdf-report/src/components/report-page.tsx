import type { ReactElement } from 'react';

import { Page, StyleSheet, Text, View } from '@react-pdf/renderer';

import { BrandMark } from './brand-mark';
import { displayable } from './text';
import { reportLayout, reportTheme, resolveReportPalette } from './theme';

import type { ReportPageProps } from '../catalog';
import type { RenderProps } from './types';

const styles = StyleSheet.create({
  page: {
    paddingTop: reportLayout.pagePaddingTop,
    paddingBottom: reportLayout.pagePaddingBottom,
    paddingLeft: reportLayout.pagePaddingX,
    paddingRight: reportLayout.pagePaddingX,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: reportTheme.text,
    backgroundColor: reportTheme.surface,
  },
  header: {
    position: 'absolute',
    top: reportLayout.headerOffset,
    left: reportLayout.pagePaddingX,
    right: reportLayout.pagePaddingX,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    borderBottomWidth: 2,
    borderBottomColor: reportTheme.brandTurquoise,
    paddingBottom: 6,
  },
  wordmark: { flexDirection: 'row', alignItems: 'center' },
  wordmarkText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: reportTheme.brandDark,
    letterSpacing: 1.2,
    marginLeft: 6,
  },
  headerRight: { alignItems: 'flex-end' },
  headerTitle: { fontSize: 10, fontWeight: 'bold', color: reportTheme.text },
  headerSubtitle: { fontSize: 8, color: reportTheme.textMuted, marginTop: 2 },
  footer: {
    position: 'absolute',
    bottom: reportLayout.footerOffset,
    left: reportLayout.pagePaddingX,
    right: reportLayout.pagePaddingX,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: reportTheme.brandTurquoise,
    paddingTop: 6,
  },
  footerText: { fontSize: 8, color: reportTheme.textMuted },
});

/**
 * The branded report page. Every `Page` element in a report spec is rewritten to
 * this component at render time, so the header/footer cannot be omitted by a
 * template author. `fixed` makes both repeat on every page.
 */
export const ReportPage = ({ props, children }: RenderProps<ReportPageProps>): ReactElement => {
  const title = props.brandTitle ?? null;
  const subtitle = props.brandSubtitle ?? null;
  const generatedAt = props.brandGeneratedAt ?? null;
  const footerNote = props.brandFooterNote ?? null;
  const wordmark = props.brandWordmark ?? 'HELIX';
  const showMark = props.brandShowMark ?? true;
  // Resolved here because this is where the caller's branding lands, and
  // published below so every component on the page reads the same palette.
  const palette = resolveReportPalette({
    accent: props.brandAccent,
    chartPalette: props.brandChartPalette,
  });
  const defaultFooter = generatedAt === null ? wordmark : `${wordmark}  -  Generated ${generatedAt}`;

  return (
    <Page
      orientation={props.orientation ?? 'portrait'}
      size={(props.size ?? 'A4') as never}
      style={[styles.page, { backgroundColor: props.backgroundColor ?? reportTheme.surface }]}
    >
      <View fixed style={[styles.header, { borderBottomColor: palette.accentSoft }]}>
        <View style={styles.wordmark}>
          {showMark ? <BrandMark color={palette.accent} size={16} /> : null}
          <Text style={styles.wordmarkText}>{displayable(wordmark)}</Text>
        </View>
        <View style={styles.headerRight}>
          {title === null ? null : <Text style={styles.headerTitle}>{displayable(title)}</Text>}
          {subtitle === null ? null : (
            <Text style={styles.headerSubtitle}>{displayable(subtitle)}</Text>
          )}
        </View>
      </View>

      {children}

      <View fixed style={[styles.footer, { borderTopColor: palette.accentSoft }]}>
        <Text style={styles.footerText}>{displayable(footerNote ?? defaultFooter)}</Text>
        <Text
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          style={styles.footerText}
        />
      </View>
    </Page>
  );
};
