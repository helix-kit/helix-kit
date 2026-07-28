import { parseAsInteger, parseAsJson, parseAsString } from 'nuqs/server';
import { z } from 'zod';

const sortingState = z.array(z.object({ id: z.string(), desc: z.boolean() }));

const DEFAULT_PAGE_SIZE = 10;

export const profilesSearchParsers = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
  name: parseAsString.withDefault(''),
  sort: parseAsJson(sortingState.parse).withDefault([{ id: 'createdAt', desc: true }]),
};
