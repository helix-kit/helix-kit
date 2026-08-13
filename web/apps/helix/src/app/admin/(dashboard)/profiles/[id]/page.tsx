import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Button } from '@helix-hq/design-system/components/button';
import { ArrowLeft } from 'lucide-react';

import { fetchQuery } from '@/server/server';

import { DevicesPanel } from './devices-panel';
import { FeaturesPanel } from './features-panel';
import { ProfileHeaderActions } from './profile-header-actions';
import { TracksPanel } from './tracks-panel';

const ProfileDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const [detail, options] = await Promise.all([
    fetchQuery((trpc) => trpc.profiles.get.queryOptions({ id })),
    fetchQuery((trpc) => trpc.profiles.trackOptions.queryOptions()),
  ]);
  if (detail === null) {
    notFound();
  }

  const { profile, tracks, devices } = detail;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-4xl gap-6 p-4 sm:p-6">
        <div className="grid gap-2">
          <Button asChild className="text-muted-foreground -ml-2.5 w-fit" size="sm" variant="ghost">
            <Link href="/admin/profiles">
              <ArrowLeft />
              Profiles
            </Link>
          </Button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
              {profile.description !== null && profile.description !== '' ? (
                <p className="text-muted-foreground text-sm">{profile.description}</p>
              ) : null}
            </div>
            <ProfileHeaderActions profile={profile} />
          </div>
        </div>

        <TracksPanel options={options} profileId={profile.id} tracks={tracks} />
        <FeaturesPanel profileId={profile.id} />
        <DevicesPanel devices={devices} profileId={profile.id} />
      </div>
    </div>
  );
};

export default ProfileDetailPage;
