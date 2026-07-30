'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helix/design-system/components/tabs';

import type { AppRouter } from '@/server/trpc';

import { ApiKeysCard } from './api-keys-card';
import { ConnectedAppsCard } from './connected-apps-card';
import { PasskeysCard } from './passkeys-card';
import { ProfileCard } from './profile-card';
import { SessionsCard } from './sessions-card';

import type { inferRouterOutputs } from '@trpc/server';

export type ConnectedApps = inferRouterOutputs<AppRouter>['account']['listConnectedApps'];

type SettingsViewProps = {
  name: string;
  email: string;
  initialConnectedApps: ConnectedApps;
};

export const SettingsView = ({ name, email, initialConnectedApps }: SettingsViewProps) => (
  <Tabs className="gap-6" defaultValue="profile">
    <TabsList>
      <TabsTrigger value="profile">Profile</TabsTrigger>
      <TabsTrigger value="sessions">Sessions</TabsTrigger>
      <TabsTrigger value="api-keys">API keys</TabsTrigger>
      <TabsTrigger value="connected">Connected apps</TabsTrigger>
      <TabsTrigger value="passkeys">Passkeys</TabsTrigger>
    </TabsList>
    <TabsContent value="profile">
      <ProfileCard email={email} name={name} />
    </TabsContent>
    <TabsContent value="sessions">
      <SessionsCard />
    </TabsContent>
    <TabsContent value="api-keys">
      <ApiKeysCard />
    </TabsContent>
    <TabsContent value="connected">
      <ConnectedAppsCard initialApps={initialConnectedApps} />
    </TabsContent>
    <TabsContent value="passkeys">
      <PasskeysCard />
    </TabsContent>
  </Tabs>
);
