import { defineCatalog } from '@json-render/core';
import { standardComponentDefinitions } from '@json-render/react-pdf/catalog';
import { schema } from '@json-render/react-pdf/server';
import { z } from 'zod';

/**
 * Optional in a template two ways: omitted entirely (hand-authored specs) or
 * explicitly null (what an LLM emits, and what the standard catalog models).
 */
const opt = <T extends z.ZodType>(inner: T) => inner.nullable().optional();

const align = z.enum(['left', 'center', 'right']);

const tone = z.enum(['default', 'danger', 'warning', 'success', 'accent']);

/**
 * The Helix report components.
 *
 * Every one of these is presentational: it lays out and styles values it is
 * handed, and computes nothing. Aggregating, filtering, grouping and formatting
 * all happen in the template's code step, which runs before any of this and
 * produces exactly the values bound here.
 *
 * That split is the point. The alternative — the props grammar these components
 * used to carry — was a small untyped programming language expressed in JSON:
 * less capable than code, and harder to read than a template.
 */
export const helixComponentDefinitions = {
  ReportPage: {
    props: z.object({
      size: opt(z.enum(['A4', 'A3', 'A5', 'LETTER', 'LEGAL', 'TABLOID'])),
      orientation: opt(z.enum(['portrait', 'landscape'])),
      backgroundColor: opt(z.string()),
      // Injected by the renderer; a template never sets these.
      brandTitle: opt(z.string()),
      brandSubtitle: opt(z.string()),
      brandGeneratedAt: opt(z.string()),
      brandFooterNote: opt(z.string()),
    }),
    slots: ['default'],
    description:
      'The branded report page. Every Page element is rewritten to this at render time, so the Helix header/footer repeats on every page and cannot be removed by a template.',
  },
  Section: {
    props: z.object({
      title: opt(z.string()),
      subtitle: opt(z.string()),
      backgroundColor: opt(z.string()),
      borderColor: opt(z.string()),
    }),
    slots: ['default'],
    description: 'A titled panel that groups report content.',
    example: { title: 'Fleet Summary', subtitle: null },
  },
  MetricGrid: {
    props: z.object({}),
    slots: ['default'],
    description: 'Lays its MetricCard children out in an evenly sized grid.',
  },
  MetricCard: {
    props: z.object({
      label: z.string(),
      /** Already formatted by the code step — rendered as given. */
      value: z.string(),
      tone: opt(tone),
      hint: opt(z.string()),
      width: opt(z.string()),
    }),
    slots: [],
    description:
      'A KPI tile. `value` is displayed verbatim, so format it in code (e.g. "167h 0m 40s", "12", "94.5%").',
    example: { label: 'Total Faults', value: '15', tone: 'danger' },
  },
  DataTable: {
    props: z.object({
      headers: z.array(z.string()),
      /** One array per row, one string per column, in `headers` order. */
      rows: z.array(z.array(z.string())),
      columnWidths: opt(z.array(z.string())),
      align: opt(z.array(align)),
      /** Background colour per row, or null to leave it alone. Length matches `rows`. */
      rowColors: opt(z.array(z.string().nullable())),
      striped: opt(z.boolean()),
      fontSize: opt(z.number()),
      headerBackgroundColor: opt(z.string()),
      borderColor: opt(z.string()),
      emptyText: opt(z.string()),
    }),
    slots: [],
    description:
      'A table of pre-formatted strings. Sorting, filtering, grouping and formatting belong in the code step; this renders the result. Row highlighting is driven by `rowColors`, which the code decides.',
    example: {
      headers: ['Device', 'Faults'],
      rows: [
        ['gateway-01', '0'],
        ['sensor-07', '3'],
      ],
    },
  },
  Callout: {
    props: z.object({
      text: z.string(),
      tone: opt(z.enum(['info', 'warning', 'danger', 'success'])),
    }),
    slots: [],
    description:
      'A short highlighted note. To show it conditionally, have the code emit the text or an empty string.',
    example: { text: '2 devices reported a fault.', tone: 'warning' },
  },
  BarChart: {
    props: z.object({
      series: z.array(z.object({ label: z.string(), value: z.number() })),
      title: opt(z.string()),
      width: opt(z.number()),
      height: opt(z.number()),
      color: opt(z.string()),
      showGrid: opt(z.boolean()),
      showValues: opt(z.boolean()),
    }),
    slots: [],
    description:
      'Vertical bar chart over pre-aggregated points, drawn as vector SVG. Grouping and aggregation belong in the code step.',
    example: { series: [{ label: 'gateway', value: 12 }] },
  },
  LineChart: {
    props: z.object({
      series: z.array(z.object({ label: z.string(), value: z.number() })),
      title: opt(z.string()),
      width: opt(z.number()),
      height: opt(z.number()),
      color: opt(z.string()),
      showGrid: opt(z.boolean()),
      area: opt(z.boolean()),
    }),
    slots: [],
    description: 'Line chart over pre-aggregated points, with an optional filled area.',
  },
  PieChart: {
    props: z.object({
      series: z.array(z.object({ label: z.string(), value: z.number() })),
      title: opt(z.string()),
      width: opt(z.number()),
      height: opt(z.number()),
      showLegend: opt(z.boolean()),
      innerRadius: opt(z.number()),
    }),
    slots: [],
    description: 'Pie chart over pre-aggregated points; set `innerRadius` above 0 for a donut.',
  },
  KeepTogether: {
    props: z.object({
      gap: opt(z.number()),
      padding: opt(z.number()),
      marginTop: opt(z.number()),
      marginBottom: opt(z.number()),
      backgroundColor: opt(z.string()),
      borderColor: opt(z.string()),
      borderWidth: opt(z.number()),
    }),
    slots: ['default'],
    description: 'Stops its children being split across a page break.',
  },
};

/**
 * Just the Helix pack.
 *
 * This is what the registry's component map is typed against — the standard
 * components are supplied by the renderer itself (`includeStandard`), not by us,
 * so the set an implementation must cover is only what this package ships.
 */
export const helixPackCatalog = defineCatalog(schema, {
  components: helixComponentDefinitions,
});

/**
 * The full authoring vocabulary: the stock react-pdf catalog plus the Helix
 * pack. This is what a template is validated against, what the editor's schema
 * is generated from, and what `prompt()` describes to a model.
 */
export const reportCatalog = defineCatalog(schema, {
  components: { ...standardComponentDefinitions, ...helixComponentDefinitions },
});

export type ReportCatalog = typeof reportCatalog;
export type HelixPackCatalog = typeof helixPackCatalog;

/**
 * The prop schemas a hand-authored template is checked against.
 *
 * The stock definitions declare every prop as `.nullable()` but not optional —
 * they model what a model should emit, where each prop is spelled out as an
 * explicit null. A template written by hand simply omits the props it does not
 * set, and the components already read them as `?? default`, so the standard
 * schemas are relaxed to make omission equivalent to null. The Helix pack
 * already models optionality directly, and stays strict — a `MetricCard` with no
 * `label` really is an error.
 */
export const authoringComponentSchemas: Record<string, z.ZodType> = {
  ...Object.fromEntries(
    Object.entries(standardComponentDefinitions).map(([name, definition]) => [
      name,
      definition.props.partial(),
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(helixComponentDefinitions).map(([name, definition]) => [name, definition.props]),
  ),
};

type PropsOf<K extends keyof typeof helixComponentDefinitions> = z.infer<
  (typeof helixComponentDefinitions)[K]['props']
>;

export type ReportPageProps = PropsOf<'ReportPage'>;
export type SectionProps = PropsOf<'Section'>;
export type MetricCardProps = PropsOf<'MetricCard'>;
export type DataTableProps = PropsOf<'DataTable'>;
export type CalloutProps = PropsOf<'Callout'>;
export type BarChartProps = PropsOf<'BarChart'>;
export type LineChartProps = PropsOf<'LineChart'>;
export type PieChartProps = PropsOf<'PieChart'>;
export type KeepTogetherProps = PropsOf<'KeepTogether'>;

/** A chart point, after the code step has aggregated. */
export type ChartPoint = { label: string; value: number };
