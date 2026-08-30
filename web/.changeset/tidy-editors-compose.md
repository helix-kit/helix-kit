---
'@helix-hq/pdf-report': minor
---

Break the template editor into composable pieces.

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
