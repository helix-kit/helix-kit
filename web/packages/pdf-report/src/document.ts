import { defaultReportTemplate } from './defaults';
import { cloneJson, isObjectRecord } from './json';

import type { ReportTemplate } from './types';

export const isReportSpec = (value: unknown): value is ReportTemplate['spec'] => {
  if (!isObjectRecord(value)) {
    return false;
  }

  return typeof value.root === 'string' && isObjectRecord(value.elements);
};

/**
 * Coerces untrusted JSON into a usable template, falling back per-field.
 *
 * Per-field rather than all-or-nothing because an editor posts whatever is in
 * its panes, and one malformed pane should not discard the other three.
 */
export const resolveReportTemplate = (value: unknown): ReportTemplate => {
  if (!isObjectRecord(value)) {
    return cloneJson(defaultReportTemplate);
  }

  return {
    inputSchema: isObjectRecord(value.inputSchema)
      ? cloneJson(value.inputSchema)
      : cloneJson(defaultReportTemplate.inputSchema),
    outputSchema: isObjectRecord(value.outputSchema)
      ? cloneJson(value.outputSchema)
      : cloneJson(defaultReportTemplate.outputSchema),
    code: typeof value.code === 'string' ? value.code : defaultReportTemplate.code,
    spec: isReportSpec(value.spec) ? cloneJson(value.spec) : cloneJson(defaultReportTemplate.spec),
    demoInput:
      value.demoInput === undefined
        ? cloneJson(defaultReportTemplate.demoInput)
        : cloneJson(value.demoInput),
  };
};
