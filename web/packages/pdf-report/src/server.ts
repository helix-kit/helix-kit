import { renderToBuffer } from '@json-render/react-pdf/render';

import { helixPdfComponents } from './components/registry';
import { prepareReport, type PrepareReportOptions } from './pipeline';

import type { ReportTemplate } from './types';

/**
 * Renders a report on the server: run the template's code, then draw its output.
 *
 * The browser path (`./browser`) runs the same pipeline, so a preview rendered
 * there matches what this produces.
 */
export const renderReportToBuffer = async (
  template: ReportTemplate,
  options: PrepareReportOptions = {},
): Promise<Uint8Array> => {
  const { spec, data } = await prepareReport(template, options);

  return renderToBuffer(spec, { registry: helixPdfComponents, state: data });
};
