import { TRPCReactProvider } from '@/server/react';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const DeviceLayout = ({ children }: { children: React.ReactNode }) => (
  <TRPCReactProvider>{children}</TRPCReactProvider>
);

export default DeviceLayout;
