'use client';

import { createTRPCContext, type TRPCOptionsProxy } from '@trpc/tanstack-react-query';

import type { AnyTRPCRouter } from '@trpc/server';

const { useTRPC, TRPCProvider } = createTRPCContext();

export { TRPCProvider as DeviceAppTRPCProvider };

export const useDeviceAppApi = <TRouter extends AnyTRPCRouter>(
  routerKey: string,
): TRPCOptionsProxy<TRouter> => {
  const proxy = useTRPC() as unknown as Record<string, TRPCOptionsProxy<TRouter>>;
  return proxy[routerKey] as TRPCOptionsProxy<TRouter>;
};
