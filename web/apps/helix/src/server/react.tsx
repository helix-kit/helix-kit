'use client';

import { useState } from 'react';

import { createTRPCReactContext } from '@helix-hq/web-core/trpc/client';
import { FeatureTRPCProvider } from '@helix-hq/web-core/trpc/feature';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createTRPCClient } from '@trpc/client';

import type { AppRouter } from '@/server/trpc';
import { createQueryClient, links } from '@/server/utils';

const { TRPCProvider, useTRPCMutation, useTRPCQuery } = createTRPCReactContext<AppRouter>();

export { useTRPCMutation, useTRPCQuery };

let clientQueryClientSingleton: QueryClient | undefined = undefined;
const getQueryClient = (): QueryClient => {
  if (typeof window === 'undefined') {
    return createQueryClient();
  }
  clientQueryClientSingleton ??= createQueryClient();
  return clientQueryClientSingleton;
};

/**
 * The app's typed context plus the untyped context that feature packages (`@helix-hq/blog`,
 * `@helix-hq/device-apps`) resolve their own routers from — both on one QueryClient, both
 * hitting /api/trpc, so mounting a feature needs no extra provider wiring.
 */
export const TRPCReactProvider = (props: { readonly children: React.ReactNode }) => {
  const queryClient = getQueryClient();

  const [appClient] = useState(() => createTRPCClient<AppRouter>({ links }));
  const [featureClient] = useState(() => createTRPCClient<AppRouter>({ links }));

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={appClient}>
        <FeatureTRPCProvider queryClient={queryClient} trpcClient={featureClient}>
          {props.children}
        </FeatureTRPCProvider>
      </TRPCProvider>
    </QueryClientProvider>
  );
};
