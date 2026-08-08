import { describe, expect, it } from 'vitest';

import {
  aggregate,
  filterRows,
  formatValue,
  groupRows,
  matchesRule,
  niceAxisMax,
  renderTemplate,
  resolveValue,
  sortRows,
  stripEmoji,
  toChartSeries,
  toNumber,
} from './utils';

const devices = [
  { name: 'a', profile: 'gateway', uptime: 120, faults: 0, crcErrors: 1, timeoutErrors: 2 },
  { name: 'b', profile: 'sensor', uptime: 60, faults: 3, crcErrors: 0, timeoutErrors: 0 },
  { name: 'c', profile: 'sensor', uptime: 30, faults: 1, crcErrors: 4, timeoutErrors: 1 },
];

describe('resolveValue', () => {
  it('reads a dot-path out of a nested object', () => {
    expect(resolveValue({ a: { b: { c: 7 } } }, { path: 'a.b.c' })).toBe(7);
  });

  it('coalesces to the first candidate path that has a value', () => {
    const row = { legacy: null, current: 'ok' };
    expect(resolveValue(row, { path: ['missing', 'legacy', 'current'] })).toBe('ok');
  });

  it('applies a per-candidate scale so mixed units normalize', () => {
    const row = { uptimeMs: 90_000 };
    expect(resolveValue(row, { path: [{ path: 'uptimeMs', scale: 0.001 }] })).toBe(90);
  });

  it('adds every sumOf field, treating absent counters as zero', () => {
    expect(resolveValue(devices[1], { sumOf: ['crcErrors', 'timeoutErrors', 'absent'] })).toBe(0);
    expect(resolveValue(devices[2], { sumOf: ['crcErrors', 'timeoutErrors'] })).toBe(5);
  });

  it('subtracts minus before scaling', () => {
    const row = { endedAt: 5_000, startedAt: 2_000 };
    expect(resolveValue(row, { path: 'endedAt', minus: 'startedAt', scale: 0.001 })).toBe(3);
  });

  it('returns undefined when minus cannot be resolved numerically', () => {
    expect(resolveValue({ endedAt: 5 }, { path: 'endedAt', minus: 'startedAt' })).toBeUndefined();
  });
});

describe('toNumber', () => {
  it('coerces the numeric strings devices emit', () => {
    expect(toNumber('42')).toBe(42);
    expect(toNumber(' 3.5 ')).toBe(3.5);
  });

  it('treats blank, NA and non-finite values as unknown', () => {
    expect(toNumber('')).toBeUndefined();
    expect(toNumber('NA')).toBeUndefined();
    expect(toNumber(Number.NaN)).toBeUndefined();
    expect(toNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('aggregate', () => {
  it('counts rows without needing a path', () => {
    expect(aggregate(devices, 'count')).toBe(3);
  });

  it('sums, averages and bounds a numeric path', () => {
    expect(aggregate(devices, 'sum', { path: 'uptime' })).toBe(210);
    expect(aggregate(devices, 'avg', { path: 'uptime' })).toBe(70);
    expect(aggregate(devices, 'min', { path: 'uptime' })).toBe(30);
    expect(aggregate(devices, 'max', { path: 'uptime' })).toBe(120);
  });

  it('counts distinct values as strings', () => {
    expect(aggregate(devices, 'distinct', { path: 'profile' })).toBe(2);
  });

  it('returns undefined when no row yields a number', () => {
    expect(aggregate(devices, 'sum', { path: 'missing' })).toBeUndefined();
  });
});

describe('matchesRule and filterRows', () => {
  it('defaults to a truthiness check on the whole row value', () => {
    expect(matchesRule({ faults: 2 }, { path: 'faults' })).toBe(true);
    expect(matchesRule({ faults: 0 }, { path: 'faults' })).toBe(false);
  });

  it('compares numerically and by string equality', () => {
    expect(matchesRule({ faults: 3 }, { path: 'faults', op: 'gt', value: 1 })).toBe(true);
    expect(matchesRule({ profile: 'sensor' }, { path: 'profile', op: 'eq', value: 'sensor' })).toBe(
      true,
    );
  });

  it('compares two fields of the same row via valuePath', () => {
    const row = { reported: 'v2', desired: 'v3' };
    expect(matchesRule(row, { path: 'reported', op: 'ne', valuePath: 'desired' })).toBe(true);
  });

  it('detects empty values', () => {
    expect(matchesRule({ note: '' }, { path: 'note', op: 'empty' })).toBe(true);
    expect(matchesRule({ note: 'x' }, { path: 'note', op: 'empty' })).toBe(false);
  });

  it('ANDs every rule and passes everything through when there are none', () => {
    expect(filterRows(devices, [{ path: 'faults', op: 'gt', value: 0 }])).toHaveLength(2);
    expect(
      filterRows(devices, [
        { path: 'faults', op: 'gt', value: 0 },
        { path: 'profile', op: 'eq', value: 'sensor' },
      ]),
    ).toHaveLength(2);
    expect(filterRows(devices, null)).toHaveLength(3);
  });
});

describe('sortRows and groupRows', () => {
  it('orders numerically in both directions without mutating the input', () => {
    const ascending = sortRows(devices, { path: 'uptime' }, 'asc');
    expect(ascending.map((row) => (row as { name: string }).name)).toEqual(['c', 'b', 'a']);
    expect(sortRows(devices, { path: 'uptime' }, 'desc')[0]).toBe(devices[0]);
    expect(devices[0]?.name).toBe('a');
  });

  it('falls back to a locale string compare for non-numeric keys', () => {
    const sorted = sortRows(devices, { path: 'profile' }, 'asc');
    expect((sorted[0] as { profile: string }).profile).toBe('gateway');
  });

  it('buckets by a dot-path preserving first-seen order', () => {
    expect(groupRows(devices, 'profile').map((bucket) => bucket.key)).toEqual([
      'gateway',
      'sensor',
    ]);
  });
});

describe('formatValue', () => {
  it('renders the placeholder for missing values', () => {
    expect(formatValue(undefined, 'integer')).toBe('—');
    expect(formatValue('', 'text', { placeholder: 'n/a' })).toBe('n/a');
  });

  it('formats durations from seconds and milliseconds', () => {
    expect(formatValue(3_725, 'duration')).toBe('1h 2m 5s');
    expect(formatValue(90, 'duration')).toBe('1m 30s');
    expect(formatValue(1_500, 'durationMs')).toBe('2s');
  });

  it('formats numbers, percents and byte sizes', () => {
    expect(formatValue(3.14159, 'number', { digits: 2 })).toBe('3.14');
    expect(formatValue(2.5, 'integer')).toBe('3');
    expect(formatValue(99.456, 'percent')).toBe('99.5%');
    expect(formatValue(0, 'bytes')).toBe('0 B');
    expect(formatValue(2_048, 'bytes')).toBe('2.0 KB');
  });

  it('formats timestamps in the requested zone and passes through unparseable ones', () => {
    expect(formatValue('2026-08-06T09:12:44.000Z', 'datetime', { timeZone: 'UTC' })).toContain(
      '06/08/2026',
    );
    expect(formatValue('not-a-date', 'datetime')).toBe('not-a-date');
  });
});

describe('renderTemplate', () => {
  it('fills dot-path placeholders and marks missing ones', () => {
    expect(renderTemplate(devices[0], '{profile} / {name}')).toBe('gateway / a');
    expect(renderTemplate(devices[0], '{missing}')).toBe('—');
  });
});

describe('toChartSeries', () => {
  it('aggregates into one point per bucket when grouping', () => {
    expect(toChartSeries(devices, { groupBy: 'profile', aggregation: 'count' })).toEqual([
      { label: 'gateway', value: 1 },
      { label: 'sensor', value: 2 },
    ]);
  });

  it('sums a yKey within each bucket', () => {
    expect(
      toChartSeries(devices, { groupBy: 'profile', aggregation: 'sum', yKey: 'uptime' }),
    ).toEqual([
      { label: 'gateway', value: 120 },
      { label: 'sensor', value: 90 },
    ]);
  });

  it('maps rows one-to-one when not grouping', () => {
    expect(toChartSeries(devices, { xKey: 'name', yKey: 'faults' })).toEqual([
      { label: 'a', value: 0 },
      { label: 'b', value: 3 },
      { label: 'c', value: 1 },
    ]);
  });
});

describe('niceAxisMax', () => {
  it('rounds up to a readable tick', () => {
    expect(niceAxisMax(0)).toBe(1);
    expect(niceAxisMax(7)).toBe(7.5);
    expect(niceAxisMax(23)).toBe(25);
    expect(niceAxisMax(101)).toBe(120);
  });
});

describe('stripEmoji', () => {
  it('removes glyphs the bundled PDF fonts cannot render', () => {
    expect(stripEmoji('Alerts ⚠️')).toBe('Alerts');
    expect(stripEmoji('  Fleet  ')).toBe('Fleet');
  });
});
