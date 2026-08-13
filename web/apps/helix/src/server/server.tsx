import 'server-only';

import { cache } from 'react';

import { headers } from 'next/headers';

import { createServerTRPC } from '@helix-hq/web-core/trpc/server';

import { appRouter, createTRPCContext } from '@/server/trpc';
import { createQueryClient } from '@/server/utils';

const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set('x-trpc-source', 'rsc');
  return createTRPCContext({
    headers: heads,
    setHeader: async () => {},
  });
});

const getQueryClient = cache(createQueryClient);

export const { fetchQuery } = createServerTRPC({
  router: appRouter,
  createContext,
  getQueryClient,
});
