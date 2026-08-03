import 'server-only';

import { cache } from 'react';

import { createServerTRPC } from '@helix/web-core/trpc/server';

import { appRouter, createTRPCContext } from '@/server/trpc';
import { createQueryClient } from '@/server/utils';

const getQueryClient = cache(createQueryClient);

/** RSC-side fetching: pages call the router in-process, with no HTTP hop. */
export const { fetchQuery } = createServerTRPC({
  router: appRouter,
  createContext: createTRPCContext,
  getQueryClient,
});
