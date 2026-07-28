import { createLoader, type SearchParams } from 'nuqs/server';

import { fetchQuery } from '@/server/server';

import { ProductsTable } from './products-table';
import { productsSearchParsers } from './search-params';

const loadSearch = createLoader(productsSearchParsers);

const ProductsPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const params = await loadSearch(searchParams);
  const [{ rows, pageCount }, filterOptions] = await Promise.all([
    fetchQuery((trpc) => trpc.releases.products.list.queryOptions(params)),
    fetchQuery((trpc) => trpc.releases.filterOptions.queryOptions()),
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 p-4 sm:p-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <p className="text-muted-foreground text-sm">
          Product lines — every version of a thing, grouped by type and name.
        </p>
      </div>

      <ProductsTable pageCount={pageCount} rows={rows} types={filterOptions.types} />
    </div>
  );
};

export default ProductsPage;
