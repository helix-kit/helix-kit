// react-pdf cannot read CSS custom properties, so the report palette is declared
// here as literal values. Keep this aligned with the app's token layer
// (web/apps/helix/src/app/globals.css).
export const reportTheme = {
  brand: '#09090b',
  brandAccent: '#0d9488',
  brandTurquoise: '#2dd4bf',
  brandDeep: '#0d9488',
  brandDark: '#09090b',
  text: '#09090b',
  textMuted: '#71717a',
  textSubtle: '#3f3f46',
  border: '#d4d4d8',
  borderSubtle: '#e4e4e7',
  surface: '#ffffff',
  surfaceMuted: '#fafafa',
  headerFill: '#f4f4f5',
  danger: '#b91c1c',
  dangerFill: '#fee2e2',
  warning: '#92400e',
  warningFill: '#fef3c7',
  success: '#15803d',
  successFill: '#dcfce7',
} as const;

// Categorical series palette for charts, ordered for good adjacent contrast.
export const chartPalette = [
  '#2dd4bf',
  '#3b82f6',
  '#f97316',
  '#a855f7',
  '#22c55e',
  '#ef4444',
  '#06b6d4',
  '#ca8a04',
  '#db2777',
] as const;

export const reportLayout = {
  pagePaddingTop: 84,
  pagePaddingBottom: 64,
  pagePaddingX: 40,
  headerOffset: 26,
  footerOffset: 26,
} as const;

/**
 * The parts of the palette that carry brand identity.
 *
 * Split out from the neutrals because only these change between installers: a
 * consumer wants their own accent and series colours, not their own grey.
 */
export type ReportPalette = {
  accent: string;
  accentSoft: string;
  chartPalette: readonly string[];
};

export const defaultReportPalette: ReportPalette = {
  accent: reportTheme.brandDeep,
  accentSoft: reportTheme.brandTurquoise,
  chartPalette,
};

/** Fills in whatever the caller left out. */
export const resolveReportPalette = (
  overrides: { accent?: string | null; chartPalette?: readonly string[] | null } = {},
): ReportPalette => {
  const accent = overrides.accent ?? defaultReportPalette.accent;
  const series =
    overrides.chartPalette === null ||
    overrides.chartPalette === undefined ||
    overrides.chartPalette.length === 0
      ? defaultReportPalette.chartPalette
      : overrides.chartPalette;
  return {
    accent,
    // The soft tone is only used for rules and left borders. Deriving it would
    // need colour maths react-pdf cannot help with, so an explicit accent
    // doubles as its own soft tone unless the palette supplies one.
    accentSoft: overrides.accent ?? defaultReportPalette.accentSoft,
    chartPalette: series,
  };
};
