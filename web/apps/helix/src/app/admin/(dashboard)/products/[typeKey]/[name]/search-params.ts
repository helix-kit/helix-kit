import { parseAsArrayOf, parseAsInteger, parseAsJson, parseAsString } from 'nuqs/server';
import { z } from 'zod';

const sortingState = z.array(z.object({ id: z.string(), desc: z.boolean() }));

const DEFAULT_PAGE_SIZE = 10;

// The line page's release table is already scoped to (type_key, name) by the
// route, so only channel/status/sort (+ paging) live in the URL.
export const lineReleasesSearchParsers = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
  channel: parseAsArrayOf(parseAsString, ',').withDefault([]),
  status: parseAsArrayOf(parseAsString, ',').withDefault([]),
  sort: parseAsJson(sortingState.parse).withDefault([{ id: 'createdAt', desc: true }]),
};
