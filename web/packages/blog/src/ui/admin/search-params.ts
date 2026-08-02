import { parseAsArrayOf, parseAsInteger, parseAsJson, parseAsString } from 'nuqs/server';
import { z } from 'zod';

// DataTable serializes sort state as JSON `[{ id, desc }]`; parse it back the same way.
const sortingState = z.array(z.object({ id: z.string(), desc: z.boolean() }));

const DEFAULT_PAGE_SIZE = 10;

// Parser keys must match the admin table's column ids so the URL round-trips.
export const postsSearchParsers = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
  title: parseAsString.withDefault(''),
  status: parseAsArrayOf(parseAsString, ',').withDefault([]),
  sort: parseAsJson(sortingState.parse).withDefault([{ id: 'updatedAt', desc: true }]),
};
