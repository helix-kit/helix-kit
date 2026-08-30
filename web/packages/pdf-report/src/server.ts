import { renderToBuffer } from '@json-render/react-pdf/render';

import { createHelixPdfComponents } from './components/registry';
import { resolveReportPalette } from './components/theme';
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
  // The palette is fixed for a render, so it is bound into the registry rather
  // than threaded through a context the RSC condition cannot build.
  const registry = createHelixPdfComponents(
    resolveReportPalette({
      accent: options.branding?.accent,
      chartPalette: options.branding?.chartPalette,
    }),
  );

  return renderToBuffer(spec, { registry, state: data });
};
