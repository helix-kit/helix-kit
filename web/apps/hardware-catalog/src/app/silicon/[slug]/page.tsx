import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@helix-hq/design-system/components/badge';

import { SpecSection, SpecTable } from '@/components/spec-section';
import {
  describeComputeUnit,
  formatMb,
  formatMhz,
  humanize,
  joinOrDash,
  orDash,
  yesNo,
} from '@/lib/format';
import { fetchQuery } from '@/server/server';

import type { Metadata } from 'next';

type PageProps = { readonly params: Promise<{ slug: string }> };

/** Mutually exclusive engine sets (finding 1) render as a named group, with the boot default. */
const describeAlternative = (unit: {
  alternativeGroup: string | null;
  isDefaultAlternative: boolean;
}): string => {
  if (unit.alternativeGroup == null) {
    return '—';
  }
  return unit.isDefaultAlternative ? `${unit.alternativeGroup} (default)` : unit.alternativeGroup;
};

export const generateMetadata = async ({ params }: PageProps): Promise<Metadata> => {
  const { slug } = await params;
  const part = await fetchQuery((trpc) => trpc.silicon.detail.queryOptions({ slug }));
  return { title: part?.name ?? 'Silicon' };
};

const SiliconDetailPage = async ({ params }: PageProps) => {
  const { slug } = await params;
  const part = await fetchQuery((trpc) => trpc.silicon.detail.queryOptions({ slug }));

  if (part == null) {
    notFound();
  }

  const boards = await fetchQuery((trpc) =>
    trpc.products.bySilicon.queryOptions({ siliconSlug: slug }),
  );

  // Finding 1: units sharing an alternative group are mutually exclusive, not additive.
  const alternativeGroups = new Set(
    part.computeUnits.flatMap((unit) =>
      unit.alternativeGroup == null ? [] : [unit.alternativeGroup],
    ),
  );

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{part.name}</h1>
          <Badge variant="secondary">{humanize(part.kind)}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {orDash(part.manufacturer?.name)}
          {part.partFamily === '' ? '' : ` · ${part.partFamily}`}
          {part.processNodeNm == null ? '' : ` · ${part.processNodeNm} nm`}
        </p>
        {part.summary === '' ? null : <p className="max-w-3xl text-sm">{part.summary}</p>}
      </header>

      <SpecSection
        hint={
          alternativeGroups.size > 0
            ? 'Rows sharing an alternative group are mutually exclusive — the part runs one of them, not both.'
            : undefined
        }
        title="Compute"
      >
        <SpecTable
          headers={['Engine', 'Role', 'Cores', 'Clock', 'Cache', 'Alternative group']}
          rows={part.computeUnits.map((unit) => [
            <span key="engine" className="font-medium">
              {describeComputeUnit(unit)}
              {unit.architecture == null ? null : (
                <span className="text-muted-foreground"> · {unit.architecture.name}</span>
              )}
            </span>,
            humanize(unit.role),
            unit.coreCount,
            formatMhz(unit.maxClockMhz),
            unit.l2Kb == null ? '—' : `L2 ${unit.l2Kb} KB`,
            describeAlternative(unit),
          ])}
        />
      </SpecSection>

      <SpecSection
        hint="Throughput is meaningless without the precision it was measured at."
        title="Accelerators"
      >
        <SpecTable
          headers={['Engine', 'Precision', 'Throughput', 'Conditions', 'Vendor claim']}
          rows={part.computeUnits.flatMap((unit) =>
            unit.performance.map((entry) => [
              describeComputeUnit(unit),
              entry.precision,
              `${entry.value} ${entry.unit.toUpperCase()}`,
              orDash(entry.conditions),
              yesNo(entry.isVendorClaim, ['Yes', 'Measured']),
            ]),
          )}
        />
      </SpecSection>

      <SpecSection
        hint="Where the memory physically sits decides whether it is a property of the chip or of the board."
        title="Memory"
      >
        <SpecTable
          headers={['Kind', 'Standard', 'Mounting', 'Capacity', 'Max', 'Bus', 'ECC']}
          rows={part.memory.map((row) => [
            humanize(row.kind),
            orDash(row.standard),
            humanize(row.mounting),
            formatMb(row.capacityMb),
            formatMb(row.maxCapacityMb),
            row.busWidthBits == null ? '—' : `${row.busWidthBits}-bit`,
            yesNo(row.supportsEcc),
          ])}
        />
      </SpecSection>

      <SpecSection
        hint="What the die provides. How much of it a given board routes out is on the board's page."
        title="Interfaces"
      >
        <SpecTable
          headers={['Interface', 'Count', 'Version', 'Lanes', 'Max speed', 'Multiplexing']}
          rows={part.interfaces.map((row) => [
            humanize(row.kind),
            row.count,
            orDash(row.version),
            orDash(row.lanes),
            row.maxSpeedMbps == null ? '—' : `${row.maxSpeedMbps} Mbps`,
            orDash(row.muxNotes),
          ])}
        />
      </SpecSection>

      <SpecSection hint="Encode and decode are separate capabilities." title="Video">
        <SpecTable
          headers={['Format', 'Direction', 'Profile', 'Max resolution', 'Max fps', 'Streams']}
          rows={part.codecs.map((row) => [
            row.format.toUpperCase(),
            humanize(row.direction),
            orDash(row.profile),
            row.maxWidth == null || row.maxHeight == null
              ? '—'
              : `${row.maxWidth}×${row.maxHeight}`,
            orDash(row.maxFps),
            orDash(row.maxStreams),
          ])}
        />
      </SpecSection>

      {part.isp.length === 0 ? null : (
        <SpecSection title="Image signal processor">
          <SpecTable
            headers={['Generation', 'Max sensor', 'Lanes', 'Concurrent sensors', 'Features']}
            rows={part.isp.map((row) => [
              orDash(row.generation),
              row.maxSensorMp == null ? '—' : `${row.maxSensorMp} MP`,
              orDash(row.maxLanes),
              orDash(row.maxConcurrentSensors),
              joinOrDash(row.features),
            ])}
          />
        </SpecSection>
      )}

      <SpecSection title="Radios">
        <SpecTable
          headers={['Standard', 'Generation', 'Spec', 'Bands', 'Protocols']}
          rows={part.radios.map((row) => [
            humanize(row.standard),
            orDash(row.generation),
            orDash(row.specName),
            joinOrDash(row.bands),
            joinOrDash(row.protocols),
          ])}
        />
      </SpecSection>

      <SpecSection title="Security">
        <SpecTable
          headers={['Feature', 'Detail']}
          rows={part.security.map((row) => [humanize(row.kind), orDash(row.detail)])}
        />
      </SpecSection>

      <SpecSection
        hint="One design, many orderable parts — pin count, flash, package and temperature grade all vary."
        title="Part variants"
      >
        <SpecTable
          headers={['Ordering code', 'Grade', 'Temp range', 'Package', 'Pins', 'Flash', 'RAM']}
          rows={part.variants.map((row) => [
            <span key="code" className="font-mono text-xs">
              {row.orderingCode}
            </span>,
            humanize(row.temperatureGrade),
            row.tempMinC == null || row.tempMaxC == null
              ? '—'
              : `${row.tempMinC} to ${row.tempMaxC} °C`,
            orDash(row.packageType),
            orDash(row.pinCount),
            row.onDieFlashKb == null ? '—' : `${row.onDieFlashKb} KB`,
            row.onDieRamKb == null ? '—' : `${row.onDieRamKb} KB`,
          ])}
        />
      </SpecSection>

      <SpecSection
        hint="The same chip can be a board's application processor or its radio co-processor."
        title="Products using this silicon"
      >
        <SpecTable
          headers={['Product', 'Tier', 'Role', 'Interconnect']}
          rows={boards.map((board) => [
            <Link key="name" className="hover:text-primary" href={`/products/${board.slug}`}>
              {board.name}
            </Link>,
            humanize(board.tier),
            humanize(board.role),
            orDash(board.interconnect),
          ])}
        />
      </SpecSection>
    </div>
  );
};

export default SiliconDetailPage;
