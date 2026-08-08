import { defaultReportDocument } from './defaults';
import { cloneJson, isObjectRecord } from './json';

import type { ReportDocument } from './types';

export const isReportSpec = (value: unknown): value is ReportDocument['spec'] => {
  if (!isObjectRecord(value)) {
    return false;
  }

  return typeof value.root === 'string' && isObjectRecord(value.elements);
};

/** Coerces untrusted JSON into a usable document, falling back per-field to the default. */
export const resolveReportDocument = (value: unknown): ReportDocument => {
  if (!isObjectRecord(value)) {
    return cloneJson(defaultReportDocument);
  }

  const demoData = isObjectRecord(value.demoData) ? value.demoData : defaultReportDocument.demoData;
  const spec = isReportSpec(value.spec) ? value.spec : defaultReportDocument.spec;

  return {
    demoData: cloneJson(demoData),
    spec: cloneJson(spec),
  };
};
