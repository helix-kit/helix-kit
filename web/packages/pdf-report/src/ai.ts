import { codeExecutorAuthoring } from '@helix/code-executor/ai';
import { jsonSchemaAuthoring } from '@helix/json-schema/ai';

import { REPORT_ARTIFACTS } from './artifacts';
import { reportCatalog } from './catalog';
import { prepareReport } from './pipeline';
import { renderReportToBuffer } from './server';
import { formatReportSpecIssues, validateReportSpec } from './validate';

import type { ReportTemplate } from './types';
import type { AiCapability, PromptSection } from '@helix/ai-kit';

const TWO_TIER = `A report template is two tiers, and keeping them apart is the whole design.

1. **The code step** receives \`input\` and returns display values — everything computed, aggregated, formatted or decided happens here.
2. **The layout** places those values on the page. Components are presentational: they draw what they are handed and calculate nothing.

The junction is the **output schema**. The code must return exactly that shape, and every layout binding must name a path the output schema produces. A binding into a path the schema does not have renders empty, so it is rejected rather than drawn.

Consequences worth taking seriously:

- Do not sum, sort, group, round or format inside the layout. There is nowhere to put the expression, and no component evaluates one.
- Give the output schema a field per thing the page displays, named for what it is (\`totalUptime\`, \`tableRows\`, \`faultNote\`), and bind to it.
- Text a component should hide is an empty string from the code, not a conditional in the layout.`;

const BINDINGS = `Bind a prop to a value with \`{"$state": "/pointer"}\`, where the pointer is a JSON Pointer into the code's output — \`/totalFaults\`, \`/rows/0/name\`.

Every binding is checked against the output schema before anything renders. A pointer the schema does not produce fails the template, naming the element that carried it.`;

export type ReportAssistantOptions = {
  /** The template being worked on, when refining rather than starting fresh. */
  template?: ReportTemplate;
  /**
   * The template as it stands, including everything written this turn.
   *
   * The checks read this rather than taking a template as arguments. A model
   * that resends the whole template with each check is both expensive and free
   * to send something other than what it wrote — and the divergence goes
   * unnoticed, because the check passes on the version it was handed while the
   * version that reaches the editor is the other one.
   */
  current?: () => ReportTemplate;
};

/**
 * Everything an assistant needs to author a report template.
 *
 * Composed from the pieces that own each half — the executor explains writing
 * code, `@helix/json-schema` explains schemas, the catalog explains components —
 * with this capability supplying only what is genuinely its own: how the two
 * tiers meet, and the checks that span them.
 *
 * The cross-tier check is the part nothing else can offer. Neither package can
 * see the other's half, so a binding pointing at a field the code never produces
 * is invisible to both and renders as blank space in a delivered document.
 */
export const reportAuthoring = (options: ReportAssistantOptions = {}): AiCapability => {
  const { current } = options;
  const sections: PromptSection[] = [
    { id: 'report.tiers', title: 'How a report is built', body: TWO_TIER },
    { id: 'report.bindings', title: 'Binding values into the layout', body: BINDINGS },
    { id: 'report.components', title: 'Available components', body: reportCatalog.prompt() },
  ];

  return {
    id: 'report',
    sections,
    artifacts: REPORT_ARTIFACTS,
    tools: [
      {
        name: 'check_report',
        description:
          'Checks everything written so far, end to end: runs the code against the demo input, validates its output against the output schema, checks every layout binding, and renders the document. Takes no arguments — it reads what you have written. Use it before finishing, and after every fix.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => {
          const candidate = current?.();
          if (candidate === undefined) {
            return { valid: false, stage: 'host', error: 'No template has been written yet.' };
          }

          const issues = validateReportSpec(candidate.spec);
          if (issues.length > 0) {
            return { valid: false, stage: 'layout', error: formatReportSpecIssues(issues) };
          }

          try {
            const prepared = await prepareReport(candidate);
            // Rendered, not just prepared. A spec can satisfy the catalog and
            // still fail in react-pdf — a chart handed the wrong shape, a table
            // whose rows are not arrays — and a check that stops short of
            // drawing reports success for a document nobody can open.
            await renderReportToBuffer(candidate);
            return {
              valid: true,
              // The values the page will draw. A model that can see these
              // catches an empty table or a mis-scaled number here, rather than
              // leaving it for whoever opens the PDF.
              data: prepared.data,
              logs: prepared.logs,
            };
          } catch (error) {
            return {
              valid: false,
              stage: 'pipeline',
              error: error instanceof Error ? error.message : 'The template did not run or render.',
            };
          }
        },
      },
    ],
  };
};

/**
 * The capability set a report-authoring assistant runs with.
 *
 * Ordered so the model reads what a report *is* before how to write each part of
 * one; the composer keeps that order stable as capabilities are added.
 */
export const reportCapabilities = (options: ReportAssistantOptions = {}): AiCapability[] => {
  const { template } = options;

  return [
    reportAuthoring(options),
    jsonSchemaAuthoring(),
    codeExecutorAuthoring({
      id: 'code',
      inputSchema: template?.inputSchema,
      outputSchema: template?.outputSchema,
      sampleInput: template?.demoInput,
      // Read live, so code written after a schema change is checked against the
      // schema the model just wrote rather than the one it replaced.
      resolve: () => {
        const now = options.current?.();
        return {
          inputSchema: now?.inputSchema,
          outputSchema: now?.outputSchema,
          sampleInput: now?.demoInput,
        };
      },
    }),
  ];
};
