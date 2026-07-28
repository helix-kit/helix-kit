import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@helix/design-system/components/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@helix/design-system/components/card';
import { ThemeToggleButton } from '@helix/design-system/components/theme-toggle-button';

import { HelixMark } from '@/components/logo';
import { fetchQuery } from '@/server/server';

import { DeviceActions } from './device-actions';
import { DeviceAppsSection } from './device-apps-section';
import { DeviceCertificates } from './device-certificates';
import { DeviceFeatureOverrides } from './device-feature-overrides';
import { DeviceProfiles } from './device-profiles';

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid gap-0.5">
    <dt className="text-muted-foreground text-xs">{label}</dt>
    <dd className="text-sm">{children}</dd>
  </div>
);

const DevicePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const device = await fetchQuery((trpc) => trpc.devices.get.queryOptions({ id }));
  if (device === null) {
    notFound();
  }

  return (
    <div className="bg-background min-h-svh">
      <header className="border-border/60 flex h-14 items-center gap-2 border-b px-4 sm:px-6">
        <Link className="flex items-center gap-2 font-semibold tracking-tight" href="/">
          <HelixMark className="text-brand size-5" />
          <span>Helix</span>
        </Link>
        <div className="ml-auto">
          <ThemeToggleButton />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-3xl gap-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{device.name}</h1>
          <Badge variant={device.isActive ? 'default' : 'outline'}>
            {device.isActive ? 'Active' : 'Inactive'}
          </Badge>
          <div className="ml-auto">
            <DeviceActions
              device={{ id: device.id, name: device.name, isActive: device.isActive }}
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Device ID">
                <span className="font-mono text-xs break-all">{device.id}</span>
              </Field>
              <Field label="Status">{device.isActive ? 'Active' : 'Inactive'}</Field>
              <Field label="Events">
                <span className="tabular-nums">{device.eventCount}</span>
              </Field>
              <Field label="Last seen">
                {device.lastSeenAt === null ? 'Never' : dateFormatter.format(device.lastSeenAt)}
              </Field>
              <Field label="Created">{dateFormatter.format(device.createdAt)}</Field>
              <Field label="Updated">{dateFormatter.format(device.updatedAt)}</Field>
              <div className="col-span-2 grid gap-0.5 sm:col-span-3">
                <dt className="text-muted-foreground text-xs">Description</dt>
                <dd className="text-sm">
                  {device.description === null || device.description === '' ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    device.description
                  )}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <DeviceAppsSection deviceId={device.id} />
        <DeviceProfiles deviceId={device.id} />
        <DeviceFeatureOverrides deviceId={device.id} />
        <DeviceCertificates deviceId={device.id} />
      </main>
    </div>
  );
};

export default DevicePage;
