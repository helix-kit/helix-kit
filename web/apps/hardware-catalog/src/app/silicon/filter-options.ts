import { humanize } from '@/lib/format';

export type FilterOption = { value: string; label: string; count: number };

/**
 * Turns a database enum into pickable options, each carrying how many parts it would match.
 * Server-side, so it lives outside the client module.
 */
export const toOptions = (
  values: readonly string[],
  counts: Record<string, number>,
): FilterOption[] =>
  values.map((value) => ({ value, label: humanize(value), count: counts[value] ?? 0 }));
