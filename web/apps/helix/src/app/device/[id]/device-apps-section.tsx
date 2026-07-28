import Link from 'next/link';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';
import { isDeviceAppAvailable } from '@helix/device-apps';
import { ChevronRight } from 'lucide-react';

import { deviceApps } from '@/device-apps/registry';
import { resolveDeviceFeatureSet } from '@/device-apps/resolve';

// The device's app launcher: every registered app whose feature gating is satisfied.
export const DeviceAppsSection = async ({ deviceId }: { deviceId: string }) => {
  const features = await resolveDeviceFeatureSet(deviceId);
  const available = deviceApps.filter((app) => isDeviceAppAvailable(app, features));
  if (available.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Apps</CardTitle>
        <CardDescription>Tools available for this device.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {available.map((app) => (
          <Link
            key={app.slug}
            className="border-border/60 hover:bg-accent flex items-center gap-3 rounded-md border px-3 py-2 transition-colors"
            href={`/device/${deviceId}/${app.slug}`}
          >
            <div className="grid gap-0.5">
              <span className="text-sm font-medium">{app.title}</span>
              {app.description === undefined ? null : (
                <span className="text-muted-foreground text-xs">{app.description}</span>
              )}
            </div>
            <ChevronRight className="text-muted-foreground ml-auto size-4" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
};
