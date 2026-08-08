# @helix/pdf-report

JSON-defined PDF reports for Helix. A template is one JSON document — a
[json-render](https://json-render.dev) spec plus the data it binds to — and this
package turns it into a PDF.

The package deals with **rendering only**. It owns no database, no scheduling, no
delivery and no workflow semantics: an adopter who wants report authoring installs
it, supplies a render route, and composes everything else themselves.

## Exports

| Entry                          | Contents                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `@helix/pdf-report`            | `ReportDocument` / `ReportBranding` types, `defaultReportDocument`, `resolveReportDocument`, `isReportSpec`, JSON helpers |
| `@helix/pdf-report/server`     | `renderReportToBuffer(spec, data, branding)` — Node only                                                                  |
| `@helix/pdf-report/editor`     | `ReportTemplateEditor` — client two-pane authoring UI                                                                     |
| `@helix/pdf-report/client`     | `fetchReportPdf(...)`, `DEFAULT_RENDER_ENDPOINT`                                                                          |
| `@helix/pdf-report/components` | `helixPdfComponents` — the raw component registry                                                                         |

## The document

```ts
type ReportDocument = {
  spec: Spec; // json-render element graph
  demoData: Record<string, unknown>; // sample values the editor previews against
};
```

`spec.elements` reference data with json-render's `{ "$state": "/devices" }`
bindings, resolved against whatever `data` the caller passes at render time.

## Components

On top of the stock `@json-render/react-pdf` catalog (`Document`, `Page`, `View`,
`Row`, `Column`, `Heading`, `Text`, `Image`, `Link`, `Table`, `List`, `Divider`,
`Spacer`, `PageNumber`) the pack adds:

| Component                             | What it does                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `ReportPage`                          | Branded page with a repeating header/footer. Injected automatically — see _Branding_. |
| `Section`                             | Titled panel that groups content.                                                     |
| `MetricGrid` / `MetricCard`           | KPI tiles; each value is computed from a raw array (`data` + `agg` + `path`).         |
| `DataTable`                           | One row per record, dot-path columns, per-cell formatting, rule-based row tinting.    |
| `GroupedTable`                        | One row per distinct `groupBy` value, columns aggregated within each bucket.          |
| `SummaryTable`                        | Transposed: one row per _field_, each cell aggregated across the dataset.             |
| `Callout`                             | Conditional note that counts matching rows and hides itself when none match.          |
| `BarChart` / `LineChart` / `PieChart` | Vector SVG charts, no rasterizing.                                                    |
| `KeepTogether`                        | Stops its children being split across a page break.                                   |

They all consume **raw arrays of objects** directly. Dot-paths coalesce across
candidates (`["a.uptime_s", {"path": "a.uptime_ms", "scale": 0.001}]`), `sumOf`
adds several fields per row, `minus` subtracts one, and `where` rules filter — so
a template never needs the caller to pre-shape rows first.

## Branding

`renderReportToBuffer` rewrites every `Page` element in the spec to `ReportPage`
and stamps the caller's branding onto it. A template author cannot drop the Helix
header/footer, and cannot set the branding either — it always comes from the
caller.

## Wiring it into an app

Add the package to `transpilePackages`, and to Tailwind's `@source` list so the
editor's classes are generated.

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

- `@monaco-editor/react` loads the Monaco assets from a CDN by default. Call its
  `loader.config({ paths: { vs: … } })` in the host app to self-host them.
- The report palette is declared as literal hex in `src/components/theme.ts`:
  react-pdf cannot read CSS custom properties, so it is kept aligned with the
  app's token layer by hand.
