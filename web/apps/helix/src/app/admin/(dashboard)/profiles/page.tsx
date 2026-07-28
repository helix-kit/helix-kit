import { createLoader, type SearchParams } from 'nuqs/server';

import { fetchQuery } from '@/server/server';

import { ProfilesTable } from './profiles-table';
import { profilesSearchParsers } from './search-params';

const loadSearch = createLoader(profilesSearchParsers);

const ProfilesPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const params = await loadSearch(searchParams);
  const { rows, pageCount } = await fetchQuery((trpc) => trpc.profiles.list.queryOptions(params));

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 p-4 sm:p-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Profiles</h1>
        <p className="text-muted-foreground text-sm">
          Release-policy bundles — the tracks a device is assigned to run.
        </p>
      </div>

      <ProfilesTable pageCount={pageCount} rows={rows} />
    </div>
  );
};

export default ProfilesPage;
