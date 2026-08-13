import Link from 'next/link';

import { Badge } from '@helix-hq/design-system/components/badge';
import { createLoader, type SearchParams } from 'nuqs/server';

import { Pagination } from '@/components/pagination';
import { LivePriceChip, PriceChip } from '@/components/price-chip';
import { ProductThumbnail } from '@/components/product-media';
import { humanize, orDash } from '@/lib/format';
import { cheapestLiveByProduct } from '@/server/offers';
import { cheapestByProduct, selectedCountry } from '@/server/pricing';
import { productTierEnum } from '@/server/schema/_shared';
import { fetchQuery } from '@/server/server';

import { productsSearchParsers } from './search-params';

const loadSearch = createLoader(productsSearchParsers);

const ProductsPage = async ({ searchParams }: { readonly searchParams: Promise<SearchParams> }) => {
  const filters = await loadSearch(searchParams);

  const results = await fetchQuery((trpc) =>
    trpc.products.list.queryOptions({
      search: filters.q,
      tiers: filters.tiers as never,
      limit: filters.perPage,
      offset: (filters.page - 1) * filters.perPage,
    }),
  );
  const country = await selectedCountry();
  const live = await cheapestLiveByProduct(results.items.map((item) => item.id));
  const prices = await cheapestByProduct(
    results.items.map((item) => item.id),
    country,
  );

  const linkParams = {
    q: filters.q,
    tiers: filters.tiers.length === 0 ? undefined : filters.tiers.join(','),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
          <Link
            className={filters.tiers.length === 0 ? 'text-foreground' : 'hover:text-foreground'}
            href="/products"
          >
            <Badge variant={filters.tiers.length === 0 ? 'default' : 'outline'}>All tiers</Badge>
          </Link>
          {productTierEnum.enumValues.map((tier) => (
            <Link key={tier} className="hover:text-foreground" href={`/products?tiers=${tier}`}>
              <Badge variant={filters.tiers.includes(tier) ? 'default' : 'outline'}>
                {humanize(tier)}
              </Badge>
            </Link>
          ))}
        </div>
      </div>

      {results.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing matches. Chips, modules, boards, carriers and kits all live here — the tier tells
          them apart.
        </p>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2">
        {results.items.map((entry) => (
          <li key={entry.id} className="border-border flex gap-3 rounded-lg border p-4">
            <ProductThumbnail alt={entry.thumbnailAlt} src={entry.thumbnail} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <Link
                  className="hover:text-primary font-medium transition-colors"
                  href={`/products/${entry.slug}`}
                >
                  {entry.name}
                </Link>
                <Badge variant="secondary">{humanize(entry.tier)}</Badge>
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                {orDash(entry.manufacturer?.name)}
                {entry.familyName === '' ? '' : ` · ${entry.familyName}`}
              </div>
              <div className="mt-2">
                {/* A live vendor offer beats the estimate: it is buyable, and it names the shop. */}
                {(() => {
                  const livePrice = live.get(entry.id);
                  return livePrice == null ? (
                    <PriceChip price={prices.get(entry.id)} />
                  ) : (
                    <LivePriceChip price={livePrice} />
                  );
                })()}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Pagination
        basePath="/products"
        page={filters.page}
        params={linkParams}
        perPage={filters.perPage}
        total={results.total}
        unit="products"
      />
    </div>
  );
};

export default ProductsPage;
