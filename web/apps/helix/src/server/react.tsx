'use client';

import { useState } from 'react';

import {
  QueryClientProvider,
  type QueryClient,
  type QueryKey,
  useMutation,
  type UseMutationOptions,
  useQuery,
  type UseQueryOptions,
  type DefaultError,
} from '@tanstack/react-query';
import { createTRPCClient } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';

import type { AppRouter } from '@/server/trpc';
import { createQueryClient, links } from '@/server/utils';

const { useTRPC, TRPCProvider } = createTRPCContext<AppRouter>();

// Exposed so device pages can compose the app's tRPC context alongside the
// device-apps context under a single shared QueryClient (see device-providers).
export { TRPCProvider as AppTRPCProvider };

let clientQueryClientSingleton: QueryClient | undefined = undefined;
export const getQueryClient = (): QueryClient => {
  if (typeof window === 'undefined') {
    return createQueryClient();
  }
  clientQueryClientSingleton ??= createQueryClient();
  return clientQueryClientSingleton;
};

export const TRPCReactProvider = (props: { readonly children: React.ReactNode }) => {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links,
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
        {props.children}
      </TRPCProvider>
    </QueryClientProvider>
  );
};

// The standard client hooks: pass a builder that turns the typed tRPC proxy into
// React Query options (`.queryOptions()` / `.mutationOptions()`). This is the
// only supported client surface — there is no classic `api.x.useQuery` client.
export const useTRPCMutation = <
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TOnMutateResult = unknown,
>(
  options: (
    api: ReturnType<typeof useTRPC>,
  ) => UseMutationOptions<TData, TError, TVariables, TOnMutateResult>,
) => {
  const trpc = useTRPC();
  const mutationOptions = options(trpc);
  return useMutation(mutationOptions);
};

export const useTRPCQuery = <
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: (
    api: ReturnType<typeof useTRPC>,
  ) => UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
) => {
  const trpc = useTRPC();
  const queryOptions = options(trpc);
  return useQuery(queryOptions);
};
