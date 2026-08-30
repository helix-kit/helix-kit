# @helix-hq/pdf-report

## 0.2.0

### Minor Changes

- [`bdc6489`](https://github.com/helix-kit/helix-kit/commit/bdc648907aa5a895969407bd9b9a8d205332e722) Thanks [@jainhardik120](https://github.com/jainhardik120)! - Break the template editor into composable pieces.

  `ReportTemplateEditor` was a single component that always rendered all five
  fields, so an application could not leave one out — a fixed input schema still
  got an editable schema pane, and a preview could only run on the sample stored
  in the template.

  The `/editor` entry now exports the parts it was made of: `ReportTemplateProvider`
  owns the drafts, `useReportTemplate` reads them, `ReportInputSchemaField`,
  `ReportCodeField`, `ReportOutputSchemaField`, `ReportLayoutField` and
  `ReportDemoInputField` each render one, and `ReportPreview` / `useReportPreview`
  render the result. `ReportPreview` takes an `input` prop, so a host can preview
  against real values rather than a stored sample.

  `ReportTemplateEditor` is unchanged for callers and is now written in terms of
  those pieces.

## 0.1.2

### Patch Changes

- [`03e4e00`](https://github.com/helix-kit/helix-kit/commit/03e4e001a2944f3374d9c2264be9d166495a5753) Thanks [@jainhardik120](https://github.com/jainhardik120)! - Fix type resolution under `node16` / `nodenext`, and correct the export
  condition order.

  The shipped `.d.ts` files used extensionless relative imports (`from './compose'`),
  which ESM resolution rejects — so types silently failed to resolve for anyone
  using `"moduleResolution": "node16"` or `"nodenext"`. Declarations are now
  bundled with extensioned imports. Bundler-based setups (Next, Vite) were
  unaffected and need no changes.

  Export conditions also listed `types` after `import`. Conditions are matched in
  order, so the `types` entry was never reached and TypeScript fell back to
  guessing; `types` now comes first in every subpath.

- Updated dependencies [[`03e4e00`](https://github.com/helix-kit/helix-kit/commit/03e4e001a2944f3374d9c2264be9d166495a5753)]:
  - @helix-hq/code-executor@0.1.2
  - @helix-hq/json-schema@0.1.2
  - @helix-hq/ai-kit@0.1.1
