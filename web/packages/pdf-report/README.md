# @helix/pdf-report

JSON-defined PDF reports for Helix, in two tiers: a sandboxed code step that
turns caller data into display values, and a [json-render](https://json-render.dev)
layout that places them.

The package deals with **rendering only**. It owns no database, no scheduling, no
delivery and no workflow semantics: an adopter who wants report authoring installs
it, supplies a render route, and composes everything else themselves.

## Exports

| Entry                          | Contents                                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@helix/pdf-report`            | `ReportTemplate` / `ReportBranding`, `defaultReportTemplate`, `resolveReportTemplate`, `prepareReport`, `fetchReportPdf`, `reportCatalog`, `validateReportSpec`, `reportSpecJsonSchema` |
| `@helix/pdf-report/server`     | `renderReportToBuffer(template, options)` — Node only                                                                                                                                   |
| `@helix/pdf-report/browser`    | `renderReportToBlob(template, options)` — in-browser render                                                                                                                             |
| `@helix/pdf-report/editor`     | `ReportTemplateEditor` — schema, code, layout and preview panes                                                                                                                         |
| `@helix/pdf-report/components` | `helixPdfComponents` — the catalog-bound component registry                                                                                                                             |

## Two tiers

A template is a code step and a layout, and the two schemas between them are the
whole contract:

```ts
type ReportTemplate = {
  inputSchema: JSONSchema; // what the report is handed
  code: string; // TypeScript over `input`, returning display values
  outputSchema: JSONSchema; // what the code produces, and what `spec` may bind to
  spec: Spec; // presentation only
  demoInput: unknown; // sample input for the editor preview
};
```

`input → validate(inputSchema) → run code → validate(outputSchema) → bind into spec → PDF`

The code runs in `@helix/code-executor`'s QuickJS sandbox, so it has no network,
no filesystem and bounded CPU and memory. It is typed from `inputSchema` in the
editor, so an author gets completion on `input.devices[0].faults`.

**Why the split.** The components used to carry the computation themselves: a
`DataTable` column could coalesce dot-paths, sum several fields, subtract one
from another, apply a scale, match rules and format the result. That grammar was
a small untyped programming language expressed in JSON — less capable than code,
and harder to read than a template. Aggregation, filtering, grouping, sorting and
formatting now live in code, where they are ordinary TypeScript.

## The catalog

`src/catalog.ts` is the single source of truth for what a template may say. Each
component is declared the way json-render prescribes — a zod `props` schema,
`slots`, a `description` and an `example` — and that one declaration drives
everything downstream:

- **Typed components.** `defineRegistry(helixPackCatalog, { components })` binds
  the implementations to their declarations, so a component whose signature
  drifts from its zod schema fails to compile. Components receive resolved
  props (`{ props, children }`) rather than a raw element.
- **Validation.** `validateReportSpec(spec)` checks structure, component names
  and props, and is run by `renderReportToBuffer` before anything reaches
  react-pdf.
- **Authoring.** `reportSpecJsonSchema()` feeds the editor's JSON language
  service, giving component-name completion and inline errors.
- **AI.** `reportCatalog.prompt()` is a ready-made system prompt describing the
  whole vocabulary, including prop shapes, for generating templates.

Two catalogs are exported because they answer different questions:
`reportCatalog` is the full authoring vocabulary (stock catalog + Helix pack),
while `helixPackCatalog` covers only what this package implements, which is what
`defineRegistry` requires — the renderer supplies the standard components itself.

### What validation does and does not cover

`catalog.validate()` is not used directly. It types a spec's `props` as a loose
object — the per-component schemas describe the vocabulary but are never
enforced — and it requires `visible` on every element, which hand-authored
templates omit. So `validateReportSpec` takes the names and schemas from the
catalog and does the checking itself:

- unknown component names, reported with the available set;
- props checked against the component's zod schema, including nested shapes;
- every `{"$state": "/x"}` binding checked against `outputSchema`, so a typo'd
  path is an error rather than a silently empty cell;
- structural problems (missing root, dangling child references);
- the _shape_ of a bound prop is not checked, since its value only exists at
  render time — only that the path it reads is produced.

The stock definitions are relaxed for this check: they declare every prop
`.nullable()` but present, which is what a model should emit, whereas a
hand-written template just omits what it does not set.

## Components

Presentational only — each places values it is handed and computes nothing:

| Component                             | Takes                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `ReportPage`                          | Branded page with a repeating header/footer. Injected automatically — see _Branding_. |
| `Section`                             | Titled panel that groups content.                                                     |
| `MetricGrid` / `MetricCard`           | A KPI tile; `value` is already formatted.                                             |
| `DataTable`                           | `headers: string[]`, `rows: string[][]`, and `rowColors` the code decided.            |
| `Callout`                             | `text` and `tone`. Empty text renders nothing, which is how a template hides one.     |
| `BarChart` / `LineChart` / `PieChart` | `series: { label, value }[]`, pre-aggregated.                                         |
| `KeepTogether`                        | Stops its children being split across a page break.                                   |

They sit on top of the stock `@json-render/react-pdf` catalog (`Document`,
`Page`, `View`, `Row`, `Column`, `Heading`, `Text`, `Image`, `Link`, `Table`,
`List`, `Divider`, `Spacer`, `PageNumber`), which stays available.

## Branding

`renderReportToBuffer` rewrites every `Page` element in the spec to `ReportPage`
and stamps the caller's branding onto it. A template author cannot drop the Helix
header/footer, and cannot set the branding either — it always comes from the
caller.

## Wiring it into an app

Three lines of host config:

```ts
// next.config.ts
transpilePackages: ['@helix/pdf-report'],
// Both are server-only. Bundling them under the RSC export conditions strips
// `createContext`, which the json-render registry needs — this is the same
// wiring upstream's own react-pdf example ships.
serverExternalPackages: ['@react-pdf/renderer', '@json-render/react-pdf'],
```

```css
/* globals.css — so the editor's classes are generated */
@source '../../../../packages/pdf-report/src/**/*.{ts,tsx}';
```

The editor and `fetchReportPdf` post to a render route, `/api/pdf-report` by
default (override with the `endpoint` prop). The route is the host's to provide —
it decides auth, rate limits and the branding applied:

```ts
// app/api/pdf-report/route.ts
export const runtime = 'nodejs';

export const POST = async (request: Request) => {
  const { resolveReportDocument } = await import('@helix/pdf-report');
  const { renderReportToBuffer } = await import('@helix/pdf-report/server');

  const body = await request.json();
  const document = resolveReportDocument(body.document);
  const pdf = await renderReportToBuffer(document.spec, body.data ?? document.demoData, {
    title: 'Fleet report',
    generatedAt: new Date().toUTCString(),
  });

  return new Response(Buffer.from(pdf), {
    headers: { 'content-type': 'application/pdf' },
  });
};
```

`web/apps/helix` does exactly this — see `src/app/api/pdf-report/route.ts` and the
`/pdf-reports` page.

## Notes

- `serverExternalPackages` is not optional. `defineRegistry` ships only from
  `@json-render/react-pdf`'s root, which builds four React contexts at module
  scope; under Next's `react-server` condition `createContext` does not exist and
  a render throws. Externalising the package resolves it outside those
  conditions. Verified in a production build and against `next start`. The API
  page's server-safe-imports section does not mention this — only the example's
  `next.config.ts` does — which is
  [json-render#317](https://github.com/vercel-labs/json-render/issues/317).
- `@monaco-editor/react` loads the Monaco assets from a CDN by default. Call its
  `loader.config({ paths: { vs: … } })` in the host app to self-host them.
- The report palette is declared as literal hex in `src/components/theme.ts`:
  react-pdf cannot read CSS custom properties, so it is kept aligned with the
  app's token layer by hand.
