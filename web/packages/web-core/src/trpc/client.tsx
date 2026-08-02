'use client';

import {
  type DefaultError,
  type QueryKey,
  useMutation,
  type UseMutationOptions,
  useQuery,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { createTRPCContext } from '@trpc/tanstack-react-query';

import type { AnyTRPCRouter } from '@trpc/server';

/**
 * A typed tRPC React context plus the two hooks that are the only supported client surface:
 * both take a builder that turns the typed proxy into React Query options.
 */
export const createTRPCReactContext = <TRouter extends AnyTRPCRouter>() => {
  const { useTRPC, TRPCProvider } = createTRPCContext<TRouter>();

  const useTRPCMutation = <
    TData = unknown,
    TError = DefaultError,
    TVariables = void,
    TOnMutateResult = unknown,
  >(
    options: (
      api: ReturnType<typeof useTRPC>,
    ) => UseMutationOptions<TData, TError, TVariables, TOnMutateResult>,
  ) => useMutation(options(useTRPC()));

  const useTRPCQuery = <
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    options: (
      api: ReturnType<typeof useTRPC>,
    ) => UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  ) => useQuery(options(useTRPC()));

  return { TRPCProvider, useTRPC, useTRPCMutation, useTRPCQuery };
};
