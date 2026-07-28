import { DeviceTRPCProviders } from '@/server/device-providers';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Device pages need both the app's typed context and the device-apps untyped context; DeviceTRPCProviders supplies both under one QueryClient.
const DeviceLayout = ({ children }: { children: React.ReactNode }) => (
  <DeviceTRPCProviders>{children}</DeviceTRPCProviders>
);

export default DeviceLayout;
