import Link from 'next/link';

import { Button } from '@helix/design-system/components/button';
import { Hammer } from 'lucide-react';
import { createLoader, type SearchParams } from 'nuqs/server';

import { fetchQuery } from '@/server/server';

import { BuildsTable } from './builds-table';
import { buildsSearchParsers } from './search-params';

const loadSearch = createLoader(buildsSearchParsers);

const BuildsPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const params = await loadSearch(searchParams);
  const [{ rows, pageCount }, filterOptions] = await Promise.all([
    fetchQuery((trpc) => trpc.releases.builds.list.queryOptions(params)),
    fetchQuery((trpc) => trpc.releases.builds.filterOptions.queryOptions()),
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 p-4 sm:p-6">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Builds</h1>
          <p className="text-muted-foreground text-sm">
            CI and custom build requests, and their outcomes.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/admin/builds/new">
            <Hammer />
            New build
          </Link>
        </Button>
      </div>

      <BuildsTable pageCount={pageCount} rows={rows} types={filterOptions.types} />
    </div>
  );
};

export default BuildsPage;
