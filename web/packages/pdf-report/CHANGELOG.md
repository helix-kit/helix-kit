# @helix-hq/pdf-report

## 0.4.0

### Minor Changes

- [`0b7d9ef`](https://github.com/helix-kit/helix-kit/commit/0b7d9ef1d66ff053cae010f1030f0f2096e3ecca) Thanks [@jainhardik120](https://github.com/jainhardik120)! - Pass the palette to components by closure rather than React context.

  0.3.0 published the palette on a React context created at module scope, which is
  exactly what makes a package unusable under Next's `react-server` condition —
  `createContext` does not exist there, and a consumer's render threw
  `(0, n.createContext) is not a function`. The package's own README warns about
  this for `@react-pdf/renderer` and `@json-render/react-pdf`; the fix repeated
  the mistake. Adding the package to `serverExternalPackages` is not a workaround
  either, since the editor needs it bundled for the browser.

  `createHelixPdfComponents(palette)` now builds the registry with the palette
  bound into the components that use one, and both render entries construct it
  from the caller's branding. No context, so nothing to strip.

  Also fixes the bar chart axis: rounding an absent minimum gave every
  all-positive chart a phantom band below the axis and a `-1` tick, because
  `niceAxisMax` floors at 1. The domain calculation is now `signedDomain`, covered
  by tests.

## 0.3.0

### Minor Changes

- [`923a60c`](https://github.com/helix-kit/helix-kit/commit/923a60c2da722f455a9aae72cca96deb279df769) Thanks [@jainhardik120](https://github.com/jainhardik120)! - Branding and the chart palette now come from the caller.

  Every report was a Helix document whoever rendered it: the header read `HELIX`
  beside the Helix glyph, the footer said `Helix - Generated …`, and the accent
  colour was Helix teal. `ReportBranding` gains `wordmark`, `showMark`, `accent`
  and `chartPalette`, carried on the same channel the existing brand fields use
  and published to the components on a context. Neutrals and the semantic tones
  stay fixed.

  Also fixes `BarChart` with negative values. It took its domain from the maximum
  alone, so a negative point produced a `Rect` with a negative height and put its
  value label under the axis on top of the category labels. The chart now takes a
  signed domain, places the zero line between the extremes, and draws each bar and
  its label on the correct side. An all-positive series is unchanged.

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
