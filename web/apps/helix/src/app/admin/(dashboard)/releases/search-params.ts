import { parseAsArrayOf, parseAsInteger, parseAsJson, parseAsString } from 'nuqs/server';
import { z } from 'zod';

// Sort state serialized by the design-system DataTable is JSON `[{ id, desc }]`.
const sortingState = z.array(z.object({ id: z.string(), desc: z.boolean() }));

const DEFAULT_PAGE_SIZE = 10;

// Keys mirror the release table's column ids so the URL round-trips, and each
// filter key matches the `releases.list` tRPC input (name/typeKey/channel/status).
export const releasesSearchParsers = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
  name: parseAsString.withDefault(''),
  typeKey: parseAsArrayOf(parseAsString, ',').withDefault([]),
  channel: parseAsArrayOf(parseAsString, ',').withDefault([]),
  status: parseAsArrayOf(parseAsString, ',').withDefault([]),
  sort: parseAsJson(sortingState.parse).withDefault([{ id: 'createdAt', desc: true }]),
};
