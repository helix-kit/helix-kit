import 'server-only';

import { cache } from 'react';

import { headers } from 'next/headers';

import { type DefaultError, type FetchQueryOptions, type QueryKey } from '@tanstack/react-query';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';

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

const trpc = createTRPCOptionsProxy({
  ctx: createContext,
  router: appRouter,
  queryClient: getQueryClient,
});



export const fetchQuery = <
  TQueryFnData,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = never,
>(
  queryOptions: (
    trpcInstance: typeof trpc,
  ) => FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>,
): Promise<TData> => {
  const queryClient = getQueryClient();
  const options = queryOptions(trpc);
  return queryClient.fetchQuery(options);
};
