import Link from 'next/link';

import { type BuildCatalog } from '@helix-hq/backend/releases';
import { Button } from '@helix-hq/design-system/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@helix-hq/design-system/components/card';
import { ArrowLeft } from 'lucide-react';

import { fetchQuery } from '@/server/server';

import { BuildWizard } from './_components/build-wizard';

const Notice = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
    </CardHeader>
    <CardContent className="text-muted-foreground text-sm">{children}</CardContent>
  </Card>
);

const NewBuildPage = async () => {
  const service = await fetchQuery((trpc) => trpc.releases.builds.serviceStatus.queryOptions());

  let catalog: BuildCatalog | null = null;
  let catalogError: string | null = null;
  if (service.configured) {
    try {
      catalog = await fetchQuery((trpc) => trpc.releases.builds.catalog.queryOptions());
    } catch (error) {
      catalogError = error instanceof Error ? error.message : 'Failed to load the build catalog.';
    }
  }

  let body: React.ReactNode;
  if (!service.configured) {
    body = (
      <Notice title="Build service not configured">
        Set <code>HELIX_BUILD_WORKER_URL</code> (the build container) and{' '}
        <code>HELIX_BUILD_CALLBACK_BASE_URL</code> (the release-backend base the container calls
        back to) to enable custom firmware builds. See{' '}
        <code>docs/09-Custom-Firmware-Builds.md</code>.
      </Notice>
    );
  } else if (catalog === null) {
    body = (
      <Notice title="Could not reach the build service">
        {catalogError ?? 'The build container did not respond.'}
      </Notice>
    );
  } else {
    body = <BuildWizard catalog={catalog} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
      <div className="shrink-0">
        <Button asChild className="mb-2 -ml-2.5" size="sm" variant="ghost">
          <Link href="/admin/builds">
            <ArrowLeft />
            Builds
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">New custom firmware</h1>
        <p className="text-muted-foreground text-sm">
          Pick apps and options; the build service compiles the firmware and registers an OTA-ready
          release.
        </p>
      </div>

      {body}
    </div>
  );
};

export default NewBuildPage;
