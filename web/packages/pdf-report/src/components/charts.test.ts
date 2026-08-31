import { describe, expect, it } from 'vitest';

import { signedDomain, sliceHotspot } from './charts';
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

describe('sliceHotspot', () => {
  const pie = { cx: 100, cy: 100, innerRadius: 0, radius: 80 };

  const expectHotspot = (slice: Parameters<typeof sliceHotspot>[0]) => {
    const spot = sliceHotspot(slice);
    if (spot === null) {
      throw new Error('expected a hotspot');
    }
    return spot;
  };

  it('centres the region on the slice it belongs to', () => {
    // A quarter turn starting at 12 o'clock points north-east, so the region
    // sits up and to the right of the centre.
    const spot = sliceHotspot({ ...pie, start: -Math.PI / 2, sweep: Math.PI / 2 });
    if (spot === null) {
      throw new Error('expected a hotspot for a quarter slice');
    }
    const centreX = spot.left + spot.size / 2;
    const centreY = spot.top + spot.size / 2;
    expect(centreX).toBeGreaterThan(pie.cx);
    expect(centreY).toBeLessThan(pie.cy);
    // Centred at half the radius, so it stays well inside the circle.
    expect(Math.hypot(centreX - pie.cx, centreY - pie.cy)).toBeCloseTo(pie.radius / 2);
  });

  it('keeps the region inside the pie', () => {
    const spot = expectHotspot({ ...pie, start: 0, sweep: Math.PI / 2 });
    const corners: { x: number; y: number }[] = [
      { x: spot.left, y: spot.top },
      { x: spot.left + spot.size, y: spot.top },
      { x: spot.left, y: spot.top + spot.size },
      { x: spot.left + spot.size, y: spot.top + spot.size },
    ];
    for (const corner of corners) {
      expect(Math.hypot(corner.x - pie.cx, corner.y - pie.cy)).toBeLessThanOrEqual(pie.radius);
    }
  });

  it('gives a whole-circle series a region bounded by the pie, not the sweep', () => {
    // The width at mid-radius exceeds the depth once a slice is wide enough, so
    // depth is what caps it — otherwise a single-slice pie would claim a square
    // far larger than the circle.
    const spot = expectHotspot({ ...pie, start: 0, sweep: Math.PI * 2 });
    expect(spot.size).toBeCloseTo(pie.radius * 0.7);
  });

  it('declines a slice too thin to hold a usable region', () => {
    // Nothing is drawn rather than a one-point target sitting over its
    // neighbours; the legend entry stays clickable for these.
    expect(sliceHotspot({ ...pie, start: 0, sweep: 0.001 })).toBeNull();
  });

  it('follows the ring of a donut rather than the centre', () => {
    const spot = expectHotspot({ ...pie, innerRadius: 60, start: -Math.PI / 2, sweep: Math.PI });
    const centreY = spot.top + spot.size / 2;
    // Mid-ring is 70 from the centre, to the right of it at this angle.
    expect(spot.left + spot.size / 2).toBeCloseTo(pie.cx + 70);
    expect(centreY).toBeCloseTo(pie.cy);
    expect(spot.size).toBeCloseTo(20 * 0.7);
  });
});
