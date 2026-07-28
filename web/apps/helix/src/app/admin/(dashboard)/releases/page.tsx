import { createLoader, type SearchParams } from 'nuqs/server';

import { fetchQuery } from '@/server/server';

import { ReleasesTable } from './releases-table';
import { releasesSearchParsers } from './search-params';

const loadSearch = createLoader(releasesSearchParsers);

const ReleasesPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const params = await loadSearch(searchParams);
  const [{ rows, pageCount }, filterOptions] = await Promise.all([
    fetchQuery((trpc) => trpc.releases.list.queryOptions(params)),
    fetchQuery((trpc) => trpc.releases.filterOptions.queryOptions()),
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 p-4 sm:p-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Releases</h1>
        <p className="text-muted-foreground text-sm">
          Published and draft releases across every artifact type and channel.
        </p>
      </div>

      <ReleasesTable
        channels={filterOptions.channels}
        pageCount={pageCount}
        rows={rows}
        types={filterOptions.types}
      />
    </div>
  );
};

export default ReleasesPage;
