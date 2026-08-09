import { parseAsInteger, parseAsString } from 'nuqs/server';

const ROWS_PER_PAGE = 10;

/** Shared by the server loader and the table, so both read the same URL. */
export const reportTemplateSearchParsers = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(ROWS_PER_PAGE),
  name: parseAsString.withDefault(''),
  sort: parseAsString.withDefault(''),
};
