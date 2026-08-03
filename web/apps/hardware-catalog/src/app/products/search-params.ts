import { parseAsArrayOf, parseAsInteger, parseAsString } from 'nuqs/server';

const DEFAULT_PAGE_SIZE = 24;

export const productsSearchParsers = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
  q: parseAsString.withDefault(''),
  tiers: parseAsArrayOf(parseAsString, ',').withDefault([]),
};
