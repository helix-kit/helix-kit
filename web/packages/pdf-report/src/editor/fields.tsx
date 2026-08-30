'use client';

import { CodeEditor } from '@helix-hq/code-executor/editor';
import { JsonEditor, SchemaEditor } from '@helix-hq/json-schema/editor';

import { useReportTemplate } from './context';

import { reportSpecJsonSchema } from '../schema';


// Monaco keys models by path, so these are stable per field: a field that is
// unmounted and remounted — by a tab bar, or by a host showing it conditionally —
// comes back with its undo history and cursor intact.
const SPEC_PATH = 'helix-pdf-report-spec.json';
const DEMO_INPUT_PATH = 'helix-pdf-report-input-data.json';
const INPUT_SCHEMA_PATH = 'helix-pdf-report-input-schema.json';
const OUTPUT_SCHEMA_PATH = 'helix-pdf-report-output-schema.json';

// Built once: the catalog is static, and Monaco keys its schemas by file match.
const specSchema = { fileMatch: SPEC_PATH, schema: reportSpecJsonSchema() };

/**
 * The schema of what the report is handed.
 *
 * Applications that fix their own input shape simply do not render this — the
 * schema still types `input` in the code field, it just stops being editable.
 */
export const ReportInputSchemaField = () => {
  const { inputSchema, setInputSchema, monacoTheme } = useReportTemplate();
  return (
    <SchemaEditor
      path={INPUT_SCHEMA_PATH}
      theme={monacoTheme}
      value={inputSchema}
      onChange={setInputSchema}
    />
  );
};

/** The code step. Typed from whatever the input schema currently says. */
export const ReportCodeField = ({ className = 'h-full' }: { className?: string }) => {
  const { code, setCode, inputSchema, monacoTheme } = useReportTemplate();
  return (
    <CodeEditor
      className={className}
      inputSchema={inputSchema}
      theme={monacoTheme}
      value={code}
      onChange={setCode}
    />
  );
};

/** The schema of what the code returns, and what the layout may bind to. */
export const ReportOutputSchemaField = () => {
  const { outputSchema, setOutputSchema, monacoTheme } = useReportTemplate();
  return (
    <SchemaEditor
      path={OUTPUT_SCHEMA_PATH}
      theme={monacoTheme}
      value={outputSchema}
      onChange={setOutputSchema}
    />
  );
};

/** The spec: where the output values are drawn on the page. */
export const ReportLayoutField = ({ className = 'h-full' }: { className?: string }) => {
  const { specDraft, setSpecDraft, monacoTheme } = useReportTemplate();
  return (
    <JsonEditor
      className={className}
      path={SPEC_PATH}
      schema={specSchema}
      theme={monacoTheme}
      value={specDraft}
      onChange={setSpecDraft}
    />
  );
};

/**
 * Sample input stored with the template.
 *
 * Only worth showing when the preview has nothing better to run on. A host that
 * passes real data to `ReportPreview` should leave this out.
 */
export const ReportDemoInputField = ({ className = 'h-full' }: { className?: string }) => {
  const { demoInputDraft, setDemoInputDraft, monacoTheme } = useReportTemplate();
  return (
    <JsonEditor
      className={className}
      path={DEMO_INPUT_PATH}
      theme={monacoTheme}
      value={demoInputDraft}
      onChange={setDemoInputDraft}
    />
  );
};
