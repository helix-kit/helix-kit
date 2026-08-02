'use client';

import { createTRPCContext, type TRPCOptionsProxy } from '@trpc/tanstack-react-query';

import type { AnyTRPCRouter } from '@trpc/server';

const { useTRPC, TRPCProvider } = createTRPCContext();

/**
 * One untyped tRPC context shared by every feature package, so a host app mounts a single
 * provider no matter how many features it composes.
 */
export { TRPCProvider as FeatureTRPCProvider };

/**
 * Resolve a feature's own router from the host's root router by its mount key. A feature
 * package cannot import the host's `AppRouter`, so the mount key plus the feature's own
 * router type is the contract: mount `blog` and you get `BlogAdminRouter` back, fully typed.
 */
export const useFeatureApi = <TRouter extends AnyTRPCRouter>(
  routerKey: string,
): TRPCOptionsProxy<TRouter> => {
  const proxy = useTRPC() as unknown as Record<string, TRPCOptionsProxy<TRouter>>;
  return proxy[routerKey] as TRPCOptionsProxy<TRouter>;
};
