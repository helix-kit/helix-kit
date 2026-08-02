import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { TRPCReactProvider } from '@/server/react';
import { getSessionUser } from '@/server/require-admin';
import { fetchQuery } from '@/server/server';

import { SettingsView } from './_components/settings-view';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const user = await getSessionUser(await headers());
  if (user === null) {
    redirect('/auth/login?redirect=/dashboard/settings');
  }

  const connectedApps = await fetchQuery((trpc) => trpc.account.listConnectedApps.queryOptions());

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-muted-foreground text-sm">
            Manage your profile, active sessions, API keys, and connected apps.
          </p>
        </div>
        <TRPCReactProvider>
          <SettingsView email={user.email} initialConnectedApps={connectedApps} name={user.name} />
        </TRPCReactProvider>
      </div>
    </div>
  );
}
