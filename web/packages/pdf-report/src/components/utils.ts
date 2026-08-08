/* eslint-disable no-magic-numbers -- unit conversions and precision defaults read best inline */
import type { Aggregation, CellFormat, PathSpec, Rule, ValueSpec } from '../catalog';

// Shared helpers that let the report components consume raw data (arrays of
// objects, e.g. a device-event query's output) directly, so report authors do
// not have to pre-shape rows or series before rendering.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads a dot-path (`payload.uptime`) out of a nested object. */
const getByPath = (source: unknown, path: string): unknown => {
  if (path === '') {
    return source;
  }

  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
};

/**
 * Reads the first path that yields a value, applying that candidate's `scale`.
 *
 * Device payloads commonly ship the same fact under different keys (and units)
 * across firmware revisions, so a column can declare
 * `["a.uptime_s", {path: "a.uptime_ms", scale: 0.001}]` and coalesce them.
 */
const getByPaths = (source: unknown, path: PathSpec | PathSpec[] | undefined): unknown => {
  if (path === undefined) {
    return undefined;
  }
  const candidates = Array.isArray(path) ? path : [path];
  for (const candidate of candidates) {
    const pointer = typeof candidate === 'string' ? candidate : candidate.path;
    const scale = typeof candidate === 'string' ? undefined : candidate.scale;
    const value = getByPath(source, pointer);
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (scale === undefined) {
      return value;
    }
    const numeric = toNumber(value);
    return numeric === undefined ? value : numeric * scale;
  }
  return undefined;
};

/**
 * Resolves a value spec: reads `path` (or adds up `sumOf`), optionally subtracts
 * `minus`, then applies `scale`. The subtraction covers the very common
 * "elapsed = end - start" case (e.g. session length from two timestamps).
 */
export const resolveValue = (row: unknown, spec: ValueSpec): unknown => {
  const { scale } = spec;

  if (spec.sumOf !== undefined) {
    // Absent counters count as zero: a device that never faulted simply omits
    // the counter, which is not the same as "unknown".
    const total = spec.sumOf.reduce<number>(
      (sum, candidate) => sum + (toNumber(getByPaths(row, candidate)) ?? 0),
      0,
    );
    return total * (scale ?? 1);
  }

  const base = getByPaths(row, spec.path);

  if (spec.minus !== undefined) {
    const left = toNumber(base);
    const right = toNumber(getByPaths(row, spec.minus));
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return (left - right) * (scale ?? 1);
  }

  if (scale === undefined) {
    return base;
  }
  const numeric = toNumber(base);
  return numeric === undefined ? base : numeric * scale;
};

/** Coerces a value (including the numeric strings devices emit) to a number. */
export const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.toUpperCase() === 'NA') {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

export const toArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

const formatDuration = (seconds: number): string => {
  const total = Math.max(Math.round(seconds), 0);
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = total % SECONDS_PER_MINUTE;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${rest}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${rest}s`;
  }
  return `${rest}s`;
};

const formatDateTime = (value: unknown, timeZone: string): string => {
  const parsed = new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString('en-GB', { timeZone });
};

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const BYTES_PER_UNIT = 1024;

const formatBytes = (bytes: number, digits: number): string => {
  const absolute = Math.abs(bytes);
  const magnitude =
    absolute === 0
      ? 0
      : Math.min(
          Math.max(Math.floor(Math.log(absolute) / Math.log(BYTES_PER_UNIT)), 0),
          BYTE_UNITS.length - 1,
        );
  return `${(bytes / BYTES_PER_UNIT ** magnitude).toFixed(magnitude === 0 ? 0 : digits)} ${BYTE_UNITS[magnitude]}`;
};

/**
 * Formats a raw cell/metric value for display. Unknown or missing values render
 * as the supplied placeholder rather than "undefined".
 */
export const formatValue = (
  value: unknown,
  format: CellFormat = 'text',
  options: { digits?: number; placeholder?: string; timeZone?: string } = {},
): string => {
  const placeholder = options.placeholder ?? '—';
  const timeZone = options.timeZone ?? 'UTC';

  if (value === undefined || value === null || value === '') {
    return placeholder;
  }

  if (format === 'text') {
    return String(value);
  }

  if (format === 'datetime' || format === 'date') {
    return formatDateTime(value, timeZone);
  }

  const numeric = toNumber(value);
  if (numeric === undefined) {
    return String(value);
  }

  switch (format) {
    case 'integer':
      return String(Math.round(numeric));
    case 'number':
      return numeric.toFixed(options.digits ?? 2);
    case 'duration':
      return formatDuration(numeric);
    case 'durationMs':
      return formatDuration(numeric / MS_PER_SECOND);
    case 'bytes':
      return formatBytes(numeric, options.digits ?? 1);
    case 'percent':
      return `${numeric.toFixed(options.digits ?? 1)}%`;
    default:
      return String(value);
  }
};

/** Aggregates a raw array over an optional value spec — used by metrics, tables and charts. */
export const aggregate = (
  rows: unknown[],
  agg: Aggregation,
  spec: ValueSpec = {},
): number | undefined => {
  if (agg === 'count') {
    return rows.length;
  }

  const hasSpec = spec.sumOf !== undefined || (spec.path !== undefined && spec.path !== '');
  const raw = rows.map((row) => (hasSpec ? resolveValue(row, spec) : row));

  if (agg === 'distinct') {
    return new Set(raw.filter((entry) => entry !== undefined && entry !== null).map(String)).size;
  }

  // `resolveValue` already applied `scale`, so do not scale again here.
  const numbers = raw.map(toNumber).filter((entry): entry is number => entry !== undefined);
  if (numbers.length === 0) {
    return undefined;
  }

  switch (agg) {
    case 'sum':
      return numbers.reduce((total, entry) => total + entry, 0);
    case 'avg':
      return numbers.reduce((total, entry) => total + entry, 0) / numbers.length;
    case 'min':
      return Math.min(...numbers);
    case 'max':
      return Math.max(...numbers);
    case 'first':
      return numbers[0];
    case 'last':
      return numbers[numbers.length - 1];
    default:
      return undefined;
  }
};

/** Evaluates one conditional rule against a row — powers conditional row tinting. */
export const matchesRule = (row: unknown, rule: Rule): boolean => {
  const actual =
    rule.path === undefined && rule.sumOf === undefined ? row : resolveValue(row, rule);
  // `valuePath` compares two fields of the same row (e.g. reported vs desired).
  const expected = rule.valuePath === undefined ? rule.value : getByPath(row, rule.valuePath);
  const op = rule.op ?? 'truthy';

  if (op === 'truthy') {
    return Boolean(actual);
  }
  if (op === 'empty') {
    return actual === undefined || actual === null || actual === '';
  }
  if (op === 'eq') {
    return String(actual) === String(expected);
  }
  if (op === 'ne') {
    return String(actual) !== String(expected);
  }

  const left = toNumber(actual);
  const right = toNumber(expected);
  if (left === undefined || right === undefined) {
    return false;
  }

  switch (op) {
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    default:
      return false;
  }
};

/** Keeps only the rows matching every rule (rules are ANDed). */
export const filterRows = (rows: unknown[], where: Rule | Rule[] | null | undefined): unknown[] => {
  if (where === undefined || where === null) {
    return rows;
  }
  const rules = Array.isArray(where) ? where : [where];
  return rules.length === 0
    ? rows
    : rows.filter((row) => rules.every((rule) => matchesRule(row, rule)));
};

/**
 * Orders rows by a value spec. Candidate paths coalesce, so a sort key can fall
 * back across fields (e.g. device timestamp, else server receive time) exactly
 * the way a hand-written comparator would.
 */
export const sortRows = (
  rows: unknown[],
  spec: ValueSpec | undefined,
  direction: 'asc' | 'desc' = 'asc',
): unknown[] => {
  if (spec === undefined) {
    return rows;
  }
  const sign = direction === 'desc' ? -1 : 1;
  return [...rows].sort((left, right) => {
    const leftValue = resolveValue(left, spec);
    const rightValue = resolveValue(right, spec);
    const leftNumber = toNumber(leftValue);
    const rightNumber = toNumber(rightValue);
    if (leftNumber !== undefined && rightNumber !== undefined) {
      return (leftNumber - rightNumber) * sign;
    }
    return String(leftValue ?? '').localeCompare(String(rightValue ?? '')) * sign;
  });
};

/** Buckets rows by a dot-path, preserving first-seen order. */
export const groupRows = (rows: unknown[], groupBy: string): { key: string; rows: unknown[] }[] => {
  const buckets = new Map<string, unknown[]>();
  for (const row of rows) {
    const key = String(getByPath(row, groupBy) ?? '—');
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  return Array.from(buckets.entries()).map(([key, bucketRows]) => ({ key, rows: bucketRows }));
};

/**
 * Fills `{dot.path}` placeholders from a row, so a label can combine fields
 * ("{profile} / {deviceId}") without pre-processing. Missing values render as `—`.
 */
export const renderTemplate = (row: unknown, template: string): string =>
  template.replace(/\{([^{}]+)\}/g, (_match, path: string) => {
    const value = getByPath(row, path.trim());
    return value === undefined || value === null || value === '' ? '—' : String(value);
  });

/**
 * Turns a raw array into chart-ready `{label, value}` points. When `groupBy` is
 * set the rows are bucketed by that path and aggregated, so a chart can bind
 * straight to an unaggregated event array.
 */
export const toChartSeries = (
  rows: unknown[],
  options: {
    xKey?: string;
    yKey?: string;
    groupBy?: string;
    aggregation?: Aggregation;
  },
): { label: string; value: number }[] => {
  const { xKey, yKey, groupBy, aggregation } = options;

  if (groupBy !== undefined && groupBy !== '') {
    return groupRows(rows, groupBy).map((bucket) => ({
      label: bucket.key,
      value: aggregate(bucket.rows, aggregation ?? 'count', { path: yKey }) ?? 0,
    }));
  }

  return rows.map((row, index) => ({
    label: xKey === undefined ? String(index + 1) : String(getByPath(row, xKey) ?? index + 1),
    value: yKey === undefined ? 0 : (toNumber(getByPath(row, yKey)) ?? 0),
  }));
};

/** Chooses "nice" round axis ticks so charts don't show ragged max values. */
export const niceAxisMax = (max: number): number => {
  if (max <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find((entry) => normalized <= entry) ?? 10;
  return step * magnitude;
};

// The bundled PDF fonts have no emoji glyphs; strip them so text does not render
// as tofu boxes (the upstream standard components do the same). Ranges are listed
// separately (rather than one character class) to keep the pattern linear-time and
// avoid combining-mark ambiguity.
const isEmojiCodePoint = (codePoint: number): boolean =>
  (codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
  (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
  codePoint === 0xfe0f;

export const stripEmoji = (value: string): string =>
  Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === undefined || !isEmojiCodePoint(codePoint);
    })
    .join('')
    .trim();
