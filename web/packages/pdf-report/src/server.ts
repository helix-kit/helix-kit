import { renderToBuffer } from '@json-render/react-pdf/render';

import { helixPdfComponents } from './components/registry';
import { prepareReportSpec } from './prepare';

import type { ReportBranding } from './types';
import type { Spec } from '@json-render/core';

/**
 * Renders a report PDF on the server: the Helix component pack plus
 * auto-injected, non-removable page branding.
 *
 * The client path (`./browser`) prepares the spec identically, so a preview
 * rendered there matches what this produces.
 */
export const renderReportToBuffer = async (
  spec: Spec,
  data?: Record<string, unknown>,
  branding: ReportBranding = {},
): Promise<Uint8Array> =>
  renderToBuffer(prepareReportSpec(spec, branding), {
    registry: helixPdfComponents,
    state: data,
  });
