import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';

import type { QueryClient, DefaultError, FetchQueryOptions, QueryKey } from '@tanstack/react-query';
import type { AnyTRPCRouter, inferRouterContext } from '@trpc/server';

/**
 * Server-side (RSC) query fetching against a router, without going over HTTP. Returns the
 * options proxy and a `fetchQuery` that takes a builder over it, mirroring the client hooks.
 */
export const createServerTRPC = <TRouter extends AnyTRPCRouter>(options: {
  router: TRouter;
  createContext: () => inferRouterContext<TRouter> | Promise<inferRouterContext<TRouter>>;
  getQueryClient: () => QueryClient;
}) => {
  const trpc = createTRPCOptionsProxy<TRouter>({
    ctx: options.createContext,
    router: options.router,
    queryClient: options.getQueryClient,
  });

  const fetchQuery = <
    TQueryFnData,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
    TPageParam = never,
  >(
    queryOptions: (
      trpcInstance: typeof trpc,
    ) => FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>,
  ): Promise<TData> => options.getQueryClient().fetchQuery(queryOptions(trpc));

  return { trpc, fetchQuery };
};
