import Link from 'next/link';

import { describeComputeUnit, formatMb, humanize, orDash } from '@/lib/format';
import type { SiliconGraph } from '@/server/routers/silicon-queries';
import { fetchQuery } from '@/server/server';

import type { SearchParams } from 'nuqs/server';

const MAX_COMPARE = 8;

type Row = { label: string; hint?: string; render: (part: SiliconGraph) => React.ReactNode };

/** The version string usually already names the interface ("USB 2.0"); don't say it twice. */
const describeInterface = (row: { kind: string; version: string }): string => {
  const kind = humanize(row.kind);
  if (row.version === '') {
    return kind;
  }
  return row.version.toLowerCase().startsWith(kind.toLowerCase())
    ? row.version
    : `${kind} ${row.version}`;
};

const list = (values: readonly string[]): React.ReactNode =>
  values.length === 0 ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <ul className="space-y-0.5">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );

/**
 * The comparison grid. Rows are the dimensions the research found to be load-bearing, and each
 * one renders from the child tables rather than a flattened column — which is what lets
 * "2× A76 + 6× A55 + always-on RISC-V" and "H.264 decode, H.265 encode only" appear at all.
 */
const ROWS: readonly Row[] = [
  { label: 'Vendor', render: (part) => orDash(part.manufacturer?.name) },
  { label: 'Kind', render: (part) => humanize(part.kind) },
  {
    label: 'Process',
    render: (part) => (part.processNodeNm == null ? '—' : `${part.processNodeNm} nm`),
  },
  {
    label: 'Compute',
    hint: 'One row per engine; alternatives are marked',
    render: (part) =>
      list(
        part.computeUnits.map((unit) => {
          const alternative = unit.alternativeGroup == null ? '' : ` (or ${unit.alternativeGroup})`;
          return `${describeComputeUnit(unit)} — ${humanize(unit.role)}${alternative}`;
        }),
      ),
  },
  {
    label: 'ISAs',
    render: (part) =>
      list([
        ...new Set(
          part.computeUnits.flatMap((unit) =>
            unit.architecture == null ? [] : [unit.architecture.name],
          ),
        ),
      ]),
  },
  {
    label: 'Accelerators',
    hint: 'Throughput always with its precision',
    render: (part) =>
      list(
        part.computeUnits.flatMap((unit) =>
          unit.performance.map(
            (entry) =>
              `${unit.coreDesign?.name ?? unit.label}: ${entry.value} ${entry.unit.toUpperCase()} @ ${entry.precision}`,
          ),
        ),
      ),
  },
  {
    label: 'Memory',
    render: (part) =>
      list(
        part.memory.map((row) => {
          const capacity =
            row.capacityMb == null ? formatMb(row.maxCapacityMb) : formatMb(row.capacityMb);
          return `${row.standard === '' ? humanize(row.kind) : row.standard} · ${capacity} · ${humanize(row.mounting)}`;
        }),
      ),
  },
  {
    label: 'Interfaces',
    render: (part) => list(part.interfaces.map((row) => `${row.count}× ${describeInterface(row)}`)),
  },
  {
    label: 'Video',
    hint: 'Encode and decode listed separately',
    render: (part) =>
      list(part.codecs.map((row) => `${row.format.toUpperCase()} ${row.direction}`)),
  },
  {
    label: 'Radios',
    render: (part) =>
      list(
        part.radios.map(
          (row) => `${row.generation === '' ? humanize(row.standard) : row.generation}`,
        ),
      ),
  },
  {
    label: 'Security',
    render: (part) => list(part.security.map((row) => humanize(row.kind))),
  },
  {
    label: 'Part variants',
    hint: 'Grades and packages that actually ship',
    render: (part) =>
      list(part.variants.map((row) => `${row.orderingCode} · ${humanize(row.temperatureGrade)}`)),
  },
];

const ComparePage = async ({ searchParams }: { readonly searchParams: Promise<SearchParams> }) => {
  const params = await searchParams;
  const raw = params.slugs;
  const slugs = (typeof raw === 'string' ? raw.split(',') : (raw ?? []))
    .map((slug) => slug.trim())
    .filter((slug) => slug !== '')
    .slice(0, MAX_COMPARE);

  const parts =
    slugs.length === 0
      ? []
      : await fetchQuery((trpc) => trpc.silicon.compare.queryOptions({ slugs }));

  if (parts.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Compare</h1>
        <p className="text-muted-foreground text-sm">
          Pick parts from the{' '}
          <Link className="text-primary underline" href="/silicon">
            silicon list
          </Link>{' '}
          to stage a comparison.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Compare</h1>

      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-40 px-3 py-2 text-left font-medium">Dimension</th>
              {parts.map((part) => (
                <th key={part.id} className="min-w-56 px-3 py-2 text-left font-medium">
                  <Link className="hover:text-primary" href={`/silicon/${part.slug}`}>
                    {part.name}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-border border-t align-top">
                <th className="bg-muted/20 px-3 py-2 text-left font-medium">
                  {row.label}
                  {row.hint == null ? null : (
                    <span className="text-muted-foreground block text-xs font-normal">
                      {row.hint}
                    </span>
                  )}
                </th>
                {parts.map((part) => (
                  <td key={part.id} className="px-3 py-2">
                    {row.render(part)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ComparePage;
