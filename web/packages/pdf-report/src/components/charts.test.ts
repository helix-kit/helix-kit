import { describe, expect, it } from 'vitest';

import { defaultReportPalette, resolveReportPalette } from './theme';

describe('resolveReportPalette', () => {
  it('falls back to the Helix palette when the caller supplies nothing', () => {
    expect(resolveReportPalette()).toEqual(defaultReportPalette);
  });

  it('takes the caller accent for both the accent and its soft tone', () => {
    const palette = resolveReportPalette({ accent: '#e11d48' });
    expect(palette.accent).toBe('#e11d48');
    expect(palette.accentSoft).toBe('#e11d48');
  });

  it('keeps the default series colours when an empty palette is passed', () => {
    // An empty array is a caller mistake rather than a request for no colours,
    // and a chart with no series colours renders invisible slices.
    expect(resolveReportPalette({ chartPalette: [] }).chartPalette).toEqual(
      defaultReportPalette.chartPalette,
    );
  });

  it('takes the caller series colours when given', () => {
    expect(resolveReportPalette({ chartPalette: ['#111', '#222'] }).chartPalette).toEqual([
      '#111',
      '#222',
    ]);
  });
});
