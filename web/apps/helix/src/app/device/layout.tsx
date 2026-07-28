import { DeviceTRPCProviders } from '@/server/device-providers';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Public device pages live outside /admin, so they mount their own tRPC providers
// (the admin section mounts its own). Device pages need both the app's typed
// context and the device-apps untyped context — DeviceTRPCProviders supplies both
// under one QueryClient. Any user can view; mutations stay admin-gated.
const DeviceLayout = ({ children }: { children: React.ReactNode }) => (
  <DeviceTRPCProviders>{children}</DeviceTRPCProviders>
);

export default DeviceLayout;
