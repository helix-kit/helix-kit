import { parseAsArrayOf, parseAsFloat, parseAsInteger, parseAsString } from 'nuqs/server';

const DEFAULT_PAGE_SIZE = 24;

/** The filter surface of finding 1/5/8/10: filter by what a chip is made of, not just its name. */
export const siliconSearchParsers = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
  search: parseAsString.withDefault(''),
  kinds: parseAsArrayOf(parseAsString, ',').withDefault([]),
  coreKinds: parseAsArrayOf(parseAsString, ',').withDefault([]),
  interfaceKinds: parseAsArrayOf(parseAsString, ',').withDefault([]),
  radioStandards: parseAsArrayOf(parseAsString, ',').withDefault([]),
  coreDesignIds: parseAsArrayOf(parseAsString, ',').withDefault([]),
  architectureIds: parseAsArrayOf(parseAsString, ',').withDefault([]),
  manufacturerIds: parseAsArrayOf(parseAsString, ',').withDefault([]),
  minTops: parseAsFloat,
  /** Slugs staged for side-by-side comparison; the compare page reads the same key. */
  compare: parseAsArrayOf(parseAsString, ',').withDefault([]),
};
