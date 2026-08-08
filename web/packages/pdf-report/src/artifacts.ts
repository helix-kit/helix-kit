import type { ArtifactSpec } from '@helix/ai-kit';

/**
 * The parts of a template, as the model addresses them.
 *
 * Named artifacts rather than one blob because they are edited in five different
 * panes and settle at different moments — a refine touching only the layout
 * should not resend the code.
 *
 * Each kind's second segment is the `ReportTemplate` field it fills, which is
 * what lets a host route one to its pane without a lookup table.
 *
 * Kept apart from `./ai` so a browser can import the table without pulling in the
 * checks, which reach the sandbox and the whole render pipeline.
 */
export const REPORT_ARTIFACTS: ArtifactSpec[] = [
  {
    kind: 'report.inputSchema',
    description: 'JSON Schema of the data the report is given.',
    schema: { type: 'object' },
    mode: 'replace',
  },
  {
    kind: 'report.outputSchema',
    description: 'JSON Schema of what the code returns, which the layout binds to.',
    schema: { type: 'object' },
    mode: 'replace',
  },
  {
    kind: 'report.code',
    description: 'The function body turning the input into the output.',
    schema: { type: 'string' },
    mode: 'replace',
  },
  {
    kind: 'report.demoInput',
    description: 'Sample input matching the input schema, used for the preview.',
    schema: { type: 'object' },
    mode: 'replace',
  },
  {
    kind: 'report.spec',
    description: 'The page layout, streamed as SpecStream patch operations.',
    mode: 'jsonl-patch',
  },
];
