import { createLoader, type SearchParams } from 'nuqs/server';

import { fetchQuery } from '@/server/server';

import { DevicesTable } from './devices-table';
import { devicesSearchParsers } from './search-params';

const loadSearch = createLoader(devicesSearchParsers);

const DevicesPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const params = await loadSearch(searchParams);
  const { rows, pageCount } = await fetchQuery((trpc) => trpc.devices.list.queryOptions(params));

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 p-4 sm:p-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
        <p className="text-muted-foreground text-sm">
          The enrolled device registry — access tokens, activation, and last-seen.
        </p>
      </div>

      <DevicesTable pageCount={pageCount} rows={rows} />
    </div>
  );
};

export default DevicesPage;
