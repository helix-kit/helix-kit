import Link from 'next/link';

import { Badge } from '@helix/design-system/components/badge';
import { createLoader, type SearchParams } from 'nuqs/server';

import { Pagination } from '@/components/pagination';
import { PriceChip } from '@/components/price-chip';
import { describeComputeUnit, humanize, orDash } from '@/lib/format';
import { siliconFacetCounts } from '@/server/facets';
import { cheapestBySilicon, selectedCountry } from '@/server/pricing';
import { coreKindEnum, radioStandardEnum, siliconKindEnum } from '@/server/schema/_shared';
import { fetchQuery } from '@/server/server';

import { CompareBar, CompareToggle } from './compare-controls';
import { toOptions } from './filter-options';
import { SiliconFilters } from './filters';
import { siliconSearchParsers } from './search-params';

const loadSearch = createLoader(siliconSearchParsers);

const OPTION_LIMIT = 200;

/** Peripherals worth surfacing as one-click filters; the full enum is long and mostly noise. */
const FEATURED_INTERFACES = [
  'pcie',
  'ethernet',
  'usb',
  'mipi_csi',
  'mipi_dsi',
  'hdmi',
  'sdmmc',
  'can',
  'i2s',
  'adc',
] as const;

const SiliconListPage = async ({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) => {
  const filters = await loadSearch(searchParams);

  const [results, manufacturers, coreDesigns, facets] = await Promise.all([
    fetchQuery((trpc) =>
      trpc.silicon.list.queryOptions({
        search: filters.search,
        kinds: filters.kinds as never,
        coreKinds: filters.coreKinds as never,
        interfaceKinds: filters.interfaceKinds as never,
        radioStandards: filters.radioStandards as never,
        manufacturerIds: filters.manufacturerIds,
        coreDesignIds: filters.coreDesignIds,
        architectureIds: filters.architectureIds,
        minAcceleratorTops: filters.minTops ?? undefined,
        limit: filters.perPage,
        offset: (filters.page - 1) * filters.perPage,
      }),
    ),
    fetchQuery((trpc) => trpc.manufacturers.list.queryOptions({ limit: OPTION_LIMIT })),
    fetchQuery((trpc) => trpc.coreDesigns.list.queryOptions({ limit: OPTION_LIMIT })),
    siliconFacetCounts(),
  ]);

  const country = await selectedCountry();
  const prices = await cheapestBySilicon(
    results.items.map((item) => item.id),
    country,
  );

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[16rem_1fr]">
      <SiliconFilters
        coreDesigns={coreDesigns.items
          .map((row) => ({
            value: row.id,
            label: row.name,
            count: facets.coreDesigns[row.id] ?? 0,
          }))
          .filter((option) => option.count > 0)}
        coreKinds={toOptions(coreKindEnum.enumValues, facets.coreKinds)}
        interfaceKinds={toOptions(FEATURED_INTERFACES, facets.interfaceKinds)}
        kinds={toOptions(siliconKindEnum.enumValues, facets.kinds)}
        manufacturers={manufacturers.items
          .map((row) => ({
            value: row.id,
            label: row.name,
            count: facets.manufacturers[row.id] ?? 0,
          }))
          // Board vendors design no silicon; offering them here only yields empty pages.
          .filter((option) => option.count > 0)}
        radioStandards={toOptions(radioStandardEnum.enumValues, facets.radioStandards)}
      />

      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Silicon</h1>

        {results.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing matches. Records are added through the write API — the catalog ships with no
            seed data.
          </p>
        ) : null}

        <ul className="space-y-3">
          {results.items.map((part) => {
            const accelerators = part.computeUnits.filter((unit) => unit.performance.length > 0);
            return (
              <li key={part.id} className="border-border rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Link
                      className="hover:text-primary font-medium transition-colors"
                      href={`/silicon/${part.slug}`}
                    >
                      {part.name}
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      {orDash(part.manufacturer?.name)} · {humanize(part.kind)}
                      {part.processNodeNm == null ? '' : ` · ${part.processNodeNm} nm`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <PriceChip
                      price={prices.get(part.id)}
                      suffix={prices.get(part.id)?.productName}
                    />
                    <CompareToggle slug={part.slug} />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {part.computeUnits.map((unit) => (
                    <Badge key={unit.id} variant="secondary">
                      {describeComputeUnit(unit)}
                    </Badge>
                  ))}
                  {accelerators.flatMap((unit) =>
                    unit.performance.map((entry) => (
                      <Badge key={entry.id} variant="outline">
                        {entry.value} {entry.unit.toUpperCase()} @ {entry.precision}
                      </Badge>
                    )),
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <Pagination
          basePath="/silicon"
          page={filters.page}
          params={{
            search: filters.search,
            kinds: filters.kinds.length === 0 ? undefined : filters.kinds.join(','),
            coreKinds: filters.coreKinds.length === 0 ? undefined : filters.coreKinds.join(','),
            interfaceKinds:
              filters.interfaceKinds.length === 0 ? undefined : filters.interfaceKinds.join(','),
            radioStandards:
              filters.radioStandards.length === 0 ? undefined : filters.radioStandards.join(','),
            manufacturerIds:
              filters.manufacturerIds.length === 0 ? undefined : filters.manufacturerIds.join(','),
            coreDesignIds:
              filters.coreDesignIds.length === 0 ? undefined : filters.coreDesignIds.join(','),
            minTops: filters.minTops == null ? undefined : String(filters.minTops),
          }}
          perPage={filters.perPage}
          total={results.total}
          unit="parts"
        />

        <CompareBar />
      </div>
    </div>
  );
};

export default SiliconListPage;
