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

/**
 * A field reference. The object form carries its own unit conversion, which is
 * what lets a template normalize the same fact across payload variants.
 */
const pathSpec = z.union([
  z.string(),
  z.object({ path: z.string(), scale: z.number().optional() }),
]);
const pathSpecs = z.union([pathSpec, z.array(pathSpec)]);

const aggregation = z.enum(['count', 'sum', 'avg', 'min', 'max', 'first', 'last', 'distinct']);

const cellFormat = z.enum([
  'text',
  'number',
  'integer',
  'duration',
  'durationMs',
  'datetime',
  'date',
  'bytes',
  'percent',
]);

/** Reads a value out of a row: coalesce `path`, or add up `sumOf`, then `minus` and `scale`. */
const valueSpec = {
  path: pathSpecs.optional(),
  sumOf: z.array(pathSpec).optional(),
  minus: pathSpecs.optional(),
  scale: z.number().optional(),
};

/** A row predicate, over the same value grammar. */
const rule = z.object({
  ...valueSpec,
  op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'ne', 'truthy', 'empty']).optional(),
  value: z.unknown().optional(),
  valuePath: z.string().optional(),
});
const rules = z.union([rule, z.array(rule)]);

const column = z.object({
  header: z.string(),
  type: opt(z.enum(['text', 'image', 'link'])),
  linkLabel: opt(z.string()),
  imageHeight: opt(z.number()),
  imageWidth: opt(z.number()),
  path: pathSpecs.optional(),
  sumOf: opt(z.array(pathSpec)),
  template: opt(z.string()),
  rules: opt(z.array(rule.extend({ text: z.string() }))),
  scale: opt(z.number()),
  minus: opt(pathSpecs),
  width: opt(z.string()),
  align: opt(align),
  format: opt(cellFormat),
  digits: opt(z.number()),
  timeZone: opt(z.string()),
  placeholder: opt(z.string()),
});

const groupedColumn = z.object({
  header: z.string(),
  type: opt(z.enum(['group', 'value'])),
  agg: opt(aggregation),
  path: opt(pathSpecs),
  sumOf: opt(z.array(pathSpec)),
  scale: opt(z.number()),
  minus: opt(pathSpecs),
  format: opt(cellFormat),
  digits: opt(z.number()),
  width: opt(z.string()),
  align: opt(align),
  highlightAbove: opt(z.number()),
  highlightColor: opt(z.string()),
});

const summaryCell = z.union([
  z.string(),
  z.number(),
  z.object({
    ...valueSpec,
    where: rules.optional(),
    agg: aggregation.optional(),
    format: cellFormat.optional(),
    digits: z.number().optional(),
  }),
]);

const baseChartProps = {
  data: z.unknown().optional(),
  xKey: opt(z.string()),
  yKey: opt(z.string()),
  groupBy: opt(z.string()),
  aggregation: opt(aggregation),
  title: opt(z.string()),
  width: opt(z.number()),
  height: opt(z.number()),
  color: opt(z.string()),
  showLegend: opt(z.boolean()),
  showGrid: opt(z.boolean()),
  showValues: opt(z.boolean()),
  maxItems: opt(z.number()),
};

/**
 * The Helix report components, declared as json-render component definitions.
 *
 * This is the single source of truth for what a template may say: the zod
 * schemas type the React components (via `defineRegistry`), drive the authoring
 * schema handed to the editor, and are what `catalog.prompt()` describes to a
 * model asked to generate a report.
 */
export const helixComponentDefinitions = {
  ReportPage: {
    props: z.object({
      size: opt(z.enum(['A4', 'A3', 'A5', 'LETTER', 'LEGAL', 'TABLOID'])),
      orientation: opt(z.enum(['portrait', 'landscape'])),
      backgroundColor: opt(z.string()),
      // Injected by renderReportToBuffer; a template never sets these.
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
      value: z.unknown().optional(),
      data: z.unknown().optional(),
      agg: opt(aggregation),
      path: opt(pathSpecs),
      sumOf: opt(z.array(pathSpec)),
      where: opt(rules),
      scale: opt(z.number()),
      minus: opt(pathSpecs),
      format: opt(cellFormat),
      digits: opt(z.number()),
      timeZone: opt(z.string()),
      tone: opt(z.enum(['default', 'danger', 'warning', 'success', 'accent'])),
      toneWhenAbove: opt(z.number()),
      hint: opt(z.string()),
      width: opt(z.string()),
    }),
    slots: [],
    description:
      'A KPI tile. Pass `value` directly, or compute one from a raw array with `data` + `agg` (+ optional `path`).',
    example: { label: 'Total Faults', data: { $state: '/devices' }, agg: 'sum', path: 'faults' },
  },
  DataTable: {
    props: z.object({
      data: z.unknown().optional(),
      columns: z.array(column).optional(),
      rowHighlight: opt(z.array(rule.extend({ color: z.string() }))),
      where: opt(rules),
      sortBy: opt(pathSpecs),
      sortDir: opt(z.enum(['asc', 'desc'])),
      striped: opt(z.boolean()),
      fontSize: opt(z.number()),
      headerBackgroundColor: opt(z.string()),
      borderColor: opt(z.string()),
      emptyText: opt(z.string()),
      maxRows: opt(z.number()),
    }),
    slots: [],
    description:
      'One row per record of `data`, with dot-path columns, per-cell formatting and rule-based row tinting.',
    example: {
      data: { $state: '/devices' },
      columns: [{ header: 'Device', path: 'name', width: '40%' }],
    },
  },
  GroupedTable: {
    props: z.object({
      data: z.unknown().optional(),
      groupBy: z.string().optional(),
      labelTemplate: opt(z.string()),
      columns: z.array(groupedColumn).optional(),
      where: opt(rules),
      sortByColumn: opt(z.number()),
      sortDir: opt(z.enum(['asc', 'desc'])),
      fontSize: opt(z.number()),
      emptyText: opt(z.string()),
      maxRows: opt(z.number()),
    }),
    slots: [],
    description:
      'One row per distinct value of `groupBy`, with every other column aggregated over the rows in that bucket.',
  },
  SummaryTable: {
    props: z.object({
      data: z.unknown().optional(),
      columns: z
        .array(z.object({ header: z.string(), width: opt(z.string()), align: opt(align) }))
        .optional(),
      rows: z.array(z.object({ cells: z.array(summaryCell) })).optional(),
      rowHighlightColor: opt(z.string()),
      fontSize: opt(z.number()),
    }),
    slots: [],
    description:
      'Transposed: one row per field rather than per record, each cell aggregated across the whole dataset.',
  },
  Callout: {
    props: z.object({
      text: z.string().optional(),
      tone: opt(z.enum(['info', 'warning', 'danger', 'success'])),
      data: z.unknown().optional(),
      where: opt(rules),
      hideWhenEmpty: opt(z.boolean()),
    }),
    slots: [],
    description:
      'A conditional note. `{count}` in `text` is replaced with the number of matching rows, and the callout removes itself when nothing matches.',
    example: { text: '{count} device(s) reported a fault.', tone: 'warning' },
  },
  BarChart: {
    props: z.object(baseChartProps),
    slots: [],
    description: 'Vertical bar chart, drawn as vector SVG.',
  },
  LineChart: {
    props: z.object({ ...baseChartProps, area: opt(z.boolean()) }),
    slots: [],
    description: 'Line chart with an optional filled area, drawn as vector SVG.',
  },
  PieChart: {
    props: z.object({ ...baseChartProps, innerRadius: opt(z.number()) }),
    slots: [],
    description: 'Pie chart; set `innerRadius` above 0 for a donut.',
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
 * The Helix pack alone, without the stock components.
 *
 * This is what the registry's component map is typed against — the standard
 * components are supplied by the renderer itself (`includeStandard`), not by
 * us, so the set an implementation must cover is only what this package ships.
 * Exported for the same reason `helixComponentDefinitions` is: an adopter
 * building their own registry needs it.
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
 * already models optionality directly, and stays strict — a `MetricCard` with
 * no `label` really is an error.
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
export type GroupedTableProps = PropsOf<'GroupedTable'>;
export type SummaryTableProps = PropsOf<'SummaryTable'>;
export type CalloutProps = PropsOf<'Callout'>;
export type BarChartProps = PropsOf<'BarChart'>;
export type LineChartProps = PropsOf<'LineChart'>;
export type PieChartProps = PropsOf<'PieChart'>;
export type KeepTogetherProps = PropsOf<'KeepTogether'>;

export type PathSpec = z.infer<typeof pathSpec>;
export type Rule = z.infer<typeof rule>;
export type Aggregation = z.infer<typeof aggregation>;
export type CellFormat = z.infer<typeof cellFormat>;
export type ValueSpec = Pick<Rule, 'path' | 'sumOf' | 'minus' | 'scale'>;
