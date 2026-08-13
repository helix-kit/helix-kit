import { executeCode, type ExecutionLimits } from '@helix-hq/code-executor';

import { prepareReportSpec } from './prepare';

import type { ReportBranding, ReportSpec, ReportTemplate } from './types';

export type PreparedReport = {
  /** The branded, validated spec to render. */
  spec: ReportSpec;
  /** What the code produced — the state the spec's bindings read. */
  data: Record<string, unknown>;
  /** Anything the code logged, useful to an author debugging a template. */
  logs: string[];
};

export type PrepareReportOptions = {
  /** Defaults to the template's `demoInput`, which is what an editor previews. */
  input?: unknown;
  branding?: ReportBranding;
  limits?: ExecutionLimits;
};

/**
 * Runs a template's code step and returns everything needed to render it.
 *
 * The two tiers meet here: the code turns caller input into display values, and
 * the spec binds to those. Both schemas are enforced by the executor, so a
 * template that produces the wrong shape fails with a message about the shape
 * rather than rendering something subtly wrong.
 *
 * Separate from rendering because both the server and the browser renderer need
 * it, and because an editor wants the intermediate data to show an author what
 * their code actually produced.
 */
export const prepareReport = async (
  template: ReportTemplate,
  options: PrepareReportOptions = {},
): Promise<PreparedReport> => {
  const result = await executeCode<Record<string, unknown>>(template.code, {
    input: options.input === undefined ? template.demoInput : options.input,
    inputSchema: template.inputSchema,
    outputSchema: template.outputSchema,
    limits: options.limits,
  });

  if (!result.success) {
    // Logs are the only window into a failed run, so carry them into the error
    // rather than dropping them on the floor.
    const logs = result.logs.length === 0 ? '' : `\n\nLogs:\n${result.logs.join('\n')}`;
    throw new Error(`Report code failed — ${result.error ?? 'unknown error'}${logs}`);
  }

  return {
    spec: prepareReportSpec(template.spec, options.branding ?? {}, template.outputSchema),
    data: result.data ?? {},
    logs: result.logs,
  };
};
