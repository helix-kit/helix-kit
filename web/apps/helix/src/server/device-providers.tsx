'use client';

import { useState } from 'react';

import { DeviceAppTRPCProvider } from '@helix/device-apps/trpc';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient } from '@trpc/client';

import { AppTRPCProvider, getQueryClient } from '@/server/react';
import type { AppRouter } from '@/server/trpc';
import { links } from '@/server/utils';

// Device pages need two tRPC contexts under one shared QueryClient: the app's typed context and the device-apps untyped context; both hit the same /api/trpc endpoint.
export const DeviceTRPCProviders = ({ children }: { children: React.ReactNode }) => {
  const queryClient = getQueryClient();
  const [appClient] = useState(() => createTRPCClient<AppRouter>({ links }));
  const [deviceAppClient] = useState(() => createTRPCClient<AppRouter>({ links }));

  return (
    <QueryClientProvider client={queryClient}>
      <AppTRPCProvider queryClient={queryClient} trpcClient={appClient}>
        <DeviceAppTRPCProvider queryClient={queryClient} trpcClient={deviceAppClient}>
          {children}
        </DeviceAppTRPCProvider>
      </AppTRPCProvider>
    </QueryClientProvider>
  );
};
