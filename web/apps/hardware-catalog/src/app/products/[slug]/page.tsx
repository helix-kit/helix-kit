import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@helix/design-system/components/badge';

import { ProductGallery, ProductLinks } from '@/components/product-media';
import { SpecSection, SpecTable } from '@/components/spec-section';
import {
  countryName,
  formatMb,
  formatMoney,
  humanize,
  joinOrDash,
  orDash,
  yesNo,
} from '@/lib/format';
import { fetchQuery } from '@/server/server';

import type { Metadata } from 'next';

const ISO_DATE_LENGTH = 10;

type PageProps = { readonly params: Promise<{ slug: string }> };

export const generateMetadata = async ({ params }: PageProps): Promise<Metadata> => {
  const { slug } = await params;
  const entry = await fetchQuery((trpc) => trpc.products.detail.queryOptions({ slug }));
  return { title: entry?.name ?? 'Product' };
};

const ProductDetailPage = async ({ params }: PageProps) => {
  const { slug } = await params;
  const entry = await fetchQuery((trpc) => trpc.products.detail.queryOptions({ slug }));

  if (entry == null) {
    notFound();
  }

  return (
    <div className="space-y-10">
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{entry.name}</h1>
            <Badge variant="secondary">{humanize(entry.tier)}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {orDash(entry.manufacturer?.name)}
            {entry.familyName === '' ? '' : ` · ${entry.familyName}`}
          </p>
          {entry.summary === '' ? null : <p className="max-w-3xl text-sm">{entry.summary}</p>}
          <div className="pt-4">
            <h2 className="mb-3 text-lg font-semibold tracking-tight">Links</h2>
            <ProductLinks links={entry.links} />
          </div>
        </header>
        <ProductGallery images={entry.images} />
      </div>

      <SpecSection
        hint="A board is rarely one chip. The role decides which one answers a given question."
        title="Silicon"
      >
        <SpecTable
          headers={['Chip', 'Role', 'Interconnect', 'Quantity']}
          rows={entry.silicon.map((row) => [
            <Link key="chip" className="hover:text-primary" href={`/silicon/${row.silicon.slug}`}>
              {row.silicon.name}
            </Link>,
            humanize(row.role),
            orDash(row.interconnect),
            row.quantity,
          ])}
        />
      </SpecSection>

      <SpecSection
        hint="What the attached silicon provides versus what this product actually routes out."
        title="Capability vs exposure"
      >
        <SpecTable
          headers={['Interface', 'Silicon provides', 'Product exposes', 'Provided by']}
          rows={entry.capabilityGap.map((row) => [
            humanize(row.kind),
            row.siliconProvides,
            <span
              key="exposed"
              className={
                row.productExposes < row.siliconProvides ? 'text-muted-foreground' : undefined
              }
            >
              {row.productExposes}
            </span>,
            joinOrDash(row.providedBy),
          ])}
        />
      </SpecSection>

      <SpecSection title="Exposed interfaces">
        <SpecTable
          headers={['Interface', 'Count', 'Version', 'Connector', 'On header']}
          rows={entry.exposedInterfaces.map((row) => [
            humanize(row.kind),
            row.count,
            orDash(row.version),
            orDash(row.connectorDescription),
            yesNo(row.onExpansionHeader),
          ])}
        />
      </SpecSection>

      <SpecSection
        hint="One hand-entered figure per country, for rough budgeting only — not a live offer, and not a lowest price. Check the date."
        title="Indicative pricing"
      >
        <SpecTable
          headers={['Country', 'Price', 'Applies to', 'Basis', 'Tax', 'Where', 'As of']}
          rows={entry.prices.map((row) => [
            countryName(row.countryCode),
            <span key="amount" className="font-medium">
              {formatMoney(row.amountMinor, row.currencyCode)}
            </span>,
            row.variantName ?? 'Any variant',
            humanize(row.kind),
            yesNo(row.includesTax, ['Included', 'Excluded']),
            row.vendorUrl == null ? (
              '—'
            ) : (
              <Link
                key="vendor"
                className="hover:text-primary underline"
                href={row.vendorUrl}
                rel="noreferrer"
                target="_blank"
              >
                {orDash(row.vendorName)}
              </Link>
            ),
            row.asOf.toISOString().slice(0, ISO_DATE_LENGTH),
          ])}
        />
      </SpecSection>

      <SpecSection
        hint="Offers and prices attach to variants, never to the design."
        title="Variants"
      >
        <SpecTable
          headers={['Variant', 'SKU', 'RAM', 'Storage', 'Wireless', 'Region', 'Grade']}
          rows={entry.variants.map((row) => [
            row.name,
            orDash(row.sku),
            formatMb(row.ramMb),
            formatMb(row.storageMb),
            yesNo(row.hasWireless),
            orDash(row.regionCode),
            humanize(row.temperatureGrade),
          ])}
        />
      </SpecSection>

      <SpecSection
        hint="Every performance figure belongs to one of these modes."
        title="Operating modes"
      >
        <SpecTable
          headers={['Mode', 'Power budget', 'Active cores', 'CPU cap', 'GPU cap', 'Cooling']}
          rows={entry.operatingModes.map((row) => [
            `${row.name}${row.isDefault ? ' (default)' : ''}`,
            row.powerBudgetW == null ? '—' : `${row.powerBudgetW} W`,
            orDash(row.activeCpuCores),
            row.cpuClockCapMhz == null ? '—' : `${row.cpuClockCapMhz} MHz`,
            row.gpuClockCapMhz == null ? '—' : `${row.gpuClockCapMhz} MHz`,
            humanize(row.coolingRequirement),
          ])}
        />
      </SpecSection>

      <SpecSection
        hint="Never a boolean: the level travels with the exceptions behind it."
        title="Compatibility"
      >
        {entry.compatibility.length === 0 ? (
          <p className="text-muted-foreground text-sm">No data recorded.</p>
        ) : (
          <div className="space-y-4">
            {entry.compatibility.map((claim) => (
              <div key={claim.id} className="border-border rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <Badge>{humanize(claim.level)}</Badge>
                  <span className="text-sm">{orDash(claim.summary)}</span>
                </div>
                {claim.deltas.length === 0 ? null : (
                  <div className="mt-3">
                    <SpecTable
                      headers={['Signal', 'On this product', 'On target', 'Impact']}
                      rows={claim.deltas.map((delta) => [
                        delta.signal,
                        orDash(delta.subjectFunction),
                        orDash(delta.targetFunction),
                        orDash(delta.impact),
                      ])}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SpecSection>

      <SpecSection
        hint="Per component, because a board-level 'Linux: supported' says nothing useful."
        title="Software support"
      >
        <SpecTable
          headers={['Platform', 'Component', 'Level', 'Source', 'Toolchain', 'Blob']}
          rows={entry.softwareSupport.map((row) => [
            row.platform.name,
            row.component,
            humanize(row.level),
            humanize(row.source),
            orDash(row.toolchain),
            yesNo(row.requiresBlob, ['Required', 'No']),
          ])}
        />
      </SpecSection>

      <SpecSection
        hint="'Until at least' is a floor, not an end date."
        title="Lifecycle and longevity"
      >
        <SpecTable
          headers={['Scope', 'Guaranteed until', 'Minimum', 'Wording']}
          rows={entry.longevity.map((row) => [
            row.scope,
            row.guaranteedUntil?.toISOString().slice(0, ISO_DATE_LENGTH) ?? '—',
            yesNo(row.isMinimum),
            orDash(row.wording),
          ])}
        />
      </SpecSection>
    </div>
  );
};

export default ProductDetailPage;
