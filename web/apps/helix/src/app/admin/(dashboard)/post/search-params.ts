import { parseAsArrayOf, parseAsInteger, parseAsJson, parseAsString } from 'nuqs/server';
import { z } from 'zod';

// Sort state serialized by the design-system DataTable (`getSortingStateParser`)
// is JSON `[{ id, desc }]`; parse it back the same way on the server.
const sortingState = z.array(z.object({ id: z.string(), desc: z.boolean() }));

// Matches the design-system DataTable's default page size.
const DEFAULT_PAGE_SIZE = 10;

// Parser keys must match the admin table's column ids so the URL round-trips:
// `page`/`perPage`/`sort` are the DataTable built-ins; `title`/`status` are the
// filterable columns (id `title` = text filter, id `status` = faceted filter).
export const postsSearchParsers = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
  title: parseAsString.withDefault(''),
  status: parseAsArrayOf(parseAsString, ',').withDefault([]),
  sort: parseAsJson(sortingState.parse).withDefault([{ id: 'updatedAt', desc: true }]),
};
