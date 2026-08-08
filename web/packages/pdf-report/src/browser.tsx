'use client';

import type { ReactElement } from 'react';

import { JSONUIProvider, Renderer } from '@json-render/react-pdf';
import { pdf, type DocumentProps } from '@react-pdf/renderer';

import { helixPdfComponents } from './components/registry';
import { prepareReportSpec } from './prepare';

import type { ReportBranding } from './types';
import type { Spec } from '@json-render/core';

/**
 * Renders a report to a PDF blob in the browser.
 *
 * Same catalog, same components, same branding as `renderReportToBuffer` — only
 * the react-pdf entry point differs (its `browser` field swaps in the DOM build).
 * That makes this usable for a live preview without a round trip, while the
 * server path stays authoritative for delivered documents.
 */
export const renderReportToBlob = async (
  spec: Spec,
  data?: Record<string, unknown>,
  branding: ReportBranding = {},
): Promise<Blob> => {
  // Mirrors the render route, which stamps one when the caller omits it —
  // otherwise a client preview would show a blank footer where the delivered
  // document shows a timestamp.
  const prepared = prepareReportSpec(spec, {
    ...branding,
    generatedAt: branding.generatedAt ?? new Date().toUTCString(),
  });

  // `Renderer` resolves the spec into react-pdf elements and the provider
  // supplies the state its `$state` bindings read. The cast is because the tree
  // is typed as a generic component rather than a `Document`.
  const element = (
    <JSONUIProvider initialState={data}>
      <Renderer registry={helixPdfComponents} spec={prepared} />
    </JSONUIProvider>
  ) as ReactElement<DocumentProps>;

  return pdf(element).toBlob();
};
