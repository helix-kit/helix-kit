'use client';

import type { ReactElement } from 'react';

import { JSONUIProvider, Renderer } from '@json-render/react-pdf';
import { pdf, type DocumentProps } from '@react-pdf/renderer';

import { createHelixPdfComponents } from './components/registry';
import { resolveReportPalette } from './components/theme';
import { prepareReport, type PrepareReportOptions } from './pipeline';

import type { ReportTemplate } from './types';

/**
 * Renders a report to a PDF blob in the browser.
 *
 * Same pipeline, same components, same branding as `renderReportToBuffer` — only
 * the react-pdf entry point differs (its `browser` field swaps in the DOM build).
 * The code step runs here too, in the same WASM sandbox, so a live preview costs
 * no round trip while the server path stays authoritative for delivered
 * documents.
 */
export const renderReportToBlob = async (
  template: ReportTemplate,
  options: PrepareReportOptions = {},
): Promise<Blob> => {
  const { spec, data } = await prepareReport(template, {
    ...options,
    // Mirrors the render route, which stamps one when the caller omits it —
    // otherwise a client preview shows a blank footer where the delivered
    // document shows a timestamp.
    branding: {
      ...options.branding,
      generatedAt: options.branding?.generatedAt ?? new Date().toUTCString(),
    },
  });

  // The palette is fixed for a render, so it is bound into the registry rather
  // than threaded through a context the RSC condition cannot build.
  const registry = createHelixPdfComponents(
    resolveReportPalette({
      accent: options.branding?.accent,
      chartPalette: options.branding?.chartPalette,
    }),
  );

  const element = (
    <JSONUIProvider initialState={data}>
      <Renderer registry={registry} spec={spec} />
    </JSONUIProvider>
  ) as ReactElement<DocumentProps>;

  return pdf(element).toBlob();
};
