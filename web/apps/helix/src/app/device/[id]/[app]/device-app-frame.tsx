'use client';

import Link from 'next/link';

import { Button } from '@helix/design-system/components/button';
import { ThemeToggleButton } from '@helix/design-system/components/theme-toggle-button';
import { HeaderPortalProvider, HeaderPortalTarget } from '@helix/device-apps/header-portal';
import { ArrowLeft } from 'lucide-react';

import { HelixMark } from '@/components/logo';
import { getDeviceApp } from '@/device-apps/registry';

export const DeviceAppFrame = ({
  deviceId,
  deviceName,
  slug,
  enabledFeatures,
}: {
  deviceId: string;
  deviceName: string;
  slug: string;
  enabledFeatures: readonly string[];
}) => {
  const app = getDeviceApp(slug);
  if (app === null) {
    return null;
  }
  const { Surface, fullBleed } = app;

  const header = (
    <header className="border-border/60 flex h-14 shrink-0 items-center gap-2 border-b px-4 sm:px-6">
      <Link className="flex items-center gap-2 font-semibold tracking-tight" href="/">
        <HelixMark className="text-brand size-5" />
        <span className="hidden sm:inline">Helix</span>
      </Link>
      <Button asChild className="text-muted-foreground -ml-1 w-fit" size="sm" variant="ghost">
        <Link href={`/device/${deviceId}`}>
          <ArrowLeft />
          {deviceName}
        </Link>
      </Button>
      <span className="text-muted-foreground/40">/</span>
      <span className="truncate text-sm font-medium">{app.title}</span>
      <div className="ml-auto flex items-center gap-3">
        <HeaderPortalTarget className="flex items-center gap-3" />
        <ThemeToggleButton />
      </div>
    </header>
  );

  return (
    <HeaderPortalProvider>
      {fullBleed === true ? (
        <div className="bg-background flex h-svh flex-col">
          {header}
          <main className="min-h-0 flex-1">
            <Surface deviceId={deviceId} enabledFeatures={enabledFeatures} />
          </main>
        </div>
      ) : (
        <div className="bg-background min-h-svh">
          {header}
          <main className="mx-auto grid w-full max-w-3xl gap-6 p-4 sm:p-6">
            <div className="grid gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">{app.title}</h1>
              {app.description === undefined ? null : (
                <p className="text-muted-foreground text-sm">{app.description}</p>
              )}
            </div>
            <Surface deviceId={deviceId} enabledFeatures={enabledFeatures} />
          </main>
        </div>
      )}
    </HeaderPortalProvider>
  );
};
