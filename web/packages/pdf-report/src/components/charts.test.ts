import { describe, expect, it } from 'vitest';

import { signedDomain } from './charts';
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

describe('signedDomain', () => {
  it('leaves no room below the axis when every value is positive', () => {
    // niceAxisMax floors at 1, so rounding an absent minimum would put a
    // phantom band under the axis and label it -1.
    expect(signedDomain([10, 20, 30])).toEqual({ above: 30, below: 0, span: 30 });
  });

  it('rounds both ends when the series crosses zero', () => {
    const domain = signedDomain([30, -12]);
    expect(domain.above).toBeGreaterThanOrEqual(30);
    expect(domain.below).toBeGreaterThanOrEqual(12);
    expect(domain.span).toBe(domain.above + domain.below);
  });

  it('handles an all-negative series', () => {
    const domain = signedDomain([-5, -40]);
    expect(domain.above).toBe(1);
    expect(domain.below).toBeGreaterThanOrEqual(40);
  });
});
