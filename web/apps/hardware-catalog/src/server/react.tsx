'use client';

import { useState } from 'react';

import { createTRPCReactContext } from '@helix-hq/web-core/trpc/client';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createTRPCClient } from '@trpc/client';

import type { AppRouter } from '@/server/trpc';
import { createQueryClient, links } from '@/server/utils';

const { TRPCProvider, useTRPC, useTRPCMutation } = createTRPCReactContext<AppRouter>();

export { useTRPC, useTRPCMutation };

let clientQueryClientSingleton: QueryClient | undefined = undefined;
const getQueryClient = (): QueryClient => {
  if (typeof window === 'undefined') {
    return createQueryClient();
  }
  clientQueryClientSingleton ??= createQueryClient();
  return clientQueryClientSingleton;
};

export const TRPCReactProvider = (props: { readonly children: React.ReactNode }) => {
  const queryClient = getQueryClient();
  const [client] = useState(() => createTRPCClient<AppRouter>({ links }));

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={client}>
        {props.children}
      </TRPCProvider>
    </QueryClientProvider>
  );
};
