import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import { ArrowLeft } from 'lucide-react';
import { createLoader, type SearchParams } from 'nuqs/server';

import { fetchQuery } from '@/server/server';

import { lineReleasesSearchParsers } from './search-params';

import { ReleasesTable } from '../../../releases/releases-table';

const loadSearch = createLoader(lineReleasesSearchParsers);

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

const ProductLinePage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ typeKey: string; name: string }>;
  searchParams: Promise<SearchParams>;
}) => {
  const { typeKey, name } = await params;
  const search = await loadSearch(searchParams);

  const [line, releases] = await Promise.all([
    fetchQuery((trpc) => trpc.releases.products.get.queryOptions({ typeKey, name })),
    fetchQuery((trpc) =>
      trpc.releases.products.releases.queryOptions({ typeKey, name, ...search }),
    ),
  ]);

  if (line === null) {
    notFound();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-6">
      <div className="grid shrink-0 gap-2">
        <Button asChild className="text-muted-foreground -ml-2.5 w-fit" size="sm" variant="ghost">
          <Link href="/admin/products">
            <ArrowLeft />
            Products
          </Link>
        </Button>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{line.name}</h1>
          <span className="text-muted-foreground text-sm">{line.typeName}</span>
          <span className="text-muted-foreground text-sm">
            {line.releaseCount} release{line.releaseCount === 1 ? '' : 's'}
            {line.draftCount > 0 ? ` · ${line.draftCount} draft` : ''}
          </span>
        </div>
      </div>

      {/* Current head release per channel — what each channel currently serves
          (the release_channel_head pointer), which is not necessarily the newest
          version in the table below. */}
      {line.channelHeads.length > 0 ? (
        <div className="shrink-0">
          <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
            Currently serving
          </p>
          <div className="flex flex-wrap gap-2">
            {line.channelHeads.map((head) => (
              <div
                key={head.channel}
                className="border-border/60 bg-card/40 flex items-center gap-2 rounded-md border px-3 py-1.5"
              >
                <Badge className="font-normal" variant="secondary">
                  {head.channel}
                </Badge>
                <Link
                  className="font-mono text-xs hover:underline"
                  href={`/admin/releases/${head.releaseId}`}
                >
                  {head.version}
                </Link>
                <span className="text-muted-foreground text-xs">
                  since {dateFormatter.format(head.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <ReleasesTable
        channels={line.channels}
        pageCount={releases.pageCount}
        rows={releases.rows}
        scope="line"
        types={[]}
      />
    </div>
  );
};

export default ProductLinePage;
