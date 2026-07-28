import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@helix/design-system/components/sidebar';
import { ThemeToggleButton } from '@helix/design-system/components/theme-toggle-button';

import { getAdminUser } from '@/server/require-admin';

import { AdminSidebar } from './admin-sidebar';

const DashboardLayout = async ({ children }: { children: React.ReactNode }) => {
  const admin = await getAdminUser(await headers());
  if (admin === null) {
    redirect('/auth/login?redirect=/admin');
  }

  // Restore the collapsed/expanded state persisted by the sidebar cookie.
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false';

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AdminSidebar email={admin.email} name={admin.name} />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="border-border/60 bg-background/80 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <div className="ml-auto">
            <ThemeToggleButton />
          </div>
        </header>
        {/* Fixed-height content region: the whole page never scrolls; each page
            either fills and scrolls internally (tables) or scrolls this region. */}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default DashboardLayout;
