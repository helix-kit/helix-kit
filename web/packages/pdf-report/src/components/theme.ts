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
