import { TRPCReactProvider } from '@/server/react';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

const AdminLayout = ({ children }: { children: React.ReactNode }) => (
  <TRPCReactProvider>
    <div className="bg-background min-h-svh">{children}</div>
  </TRPCReactProvider>
);

export default AdminLayout;
