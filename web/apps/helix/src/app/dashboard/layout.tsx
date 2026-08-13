import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@helix-hq/design-system/components/sidebar';
import { ThemeToggleButton } from '@helix-hq/design-system/components/theme-toggle-button';

import { getSessionUser } from '@/server/require-admin';

import { DashboardSidebar } from './dashboard-sidebar';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

const DashboardLayout = async ({ children }: { children: React.ReactNode }) => {
  const user = await getSessionUser(await headers());
  if (user === null) {
    redirect('/auth/login?redirect=/dashboard');
  }

  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false';

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <DashboardSidebar email={user.email} isAdmin={user.isAdmin} name={user.name} />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="border-border/60 bg-background/80 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <div className="ml-auto">
            <ThemeToggleButton />
          </div>
        </header>
        {/* Fixed-height region: the page never scrolls; each page scrolls internally. */}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default DashboardLayout;
