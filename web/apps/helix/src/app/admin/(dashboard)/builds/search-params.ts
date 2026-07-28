import { parseAsArrayOf, parseAsInteger, parseAsJson, parseAsString } from 'nuqs/server';
import { z } from 'zod';

const sortingState = z.array(z.object({ id: z.string(), desc: z.boolean() }));

const DEFAULT_PAGE_SIZE = 10;

// Keys mirror the builds table's column ids and the `releases.builds.list`
// tRPC input (typeKey/source/status).
export const buildsSearchParsers = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
  typeKey: parseAsArrayOf(parseAsString, ',').withDefault([]),
  source: parseAsArrayOf(parseAsString, ',').withDefault([]),
  status: parseAsArrayOf(parseAsString, ',').withDefault([]),
  sort: parseAsJson(sortingState.parse).withDefault([{ id: 'createdAt', desc: true }]),
};
