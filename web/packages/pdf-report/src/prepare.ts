import { isReportSpec } from './document';
import { cloneJson } from './json';
import { formatReportSpecIssues, validateReportSpec } from './validate';

import type { ReportBranding } from './types';
import type { Spec, UIElement } from '@json-render/core';
import type { JSONSchema } from 'zod/v4/core';

const PAGE_TYPE = 'Page';
const REPORT_PAGE_TYPE = 'ReportPage';

/**
 * Rewrites every `Page` element to the branded `ReportPage` and stamps the
 * branding onto its props.
 *
 * Branding is applied here — not left to the template — so that no authored
 * report can ship without the Helix header/footer.
 */
const applyReportBranding = (spec: Spec, branding: ReportBranding): Spec => {
  const next = cloneJson(spec);

  for (const element of Object.values(next.elements) as UIElement[]) {
    if (element.type !== PAGE_TYPE && element.type !== REPORT_PAGE_TYPE) {
      continue;
    }

    element.type = REPORT_PAGE_TYPE;
    element.props = {
      ...element.props,
      brandTitle: branding.title ?? null,
      brandSubtitle: branding.subtitle ?? null,
      brandGeneratedAt: branding.generatedAt ?? null,
      brandFooterNote: branding.footerNote ?? null,
      brandWordmark: branding.wordmark ?? null,
      brandShowMark: branding.showMark ?? null,
      brandAccent: branding.accent ?? null,
      brandChartPalette: branding.chartPalette === undefined ? null : [...branding.chartPalette],
    };
  }

  return next;
};

/**
 * Validates a template and returns the branded spec to render.
 *
 * Shared by both render paths so a client preview and a server render cannot
 * drift: the same checks run and the same branding is stamped, which is what
 * makes the preview trustworthy as a proxy for the delivered document.
 *
 * react-pdf fails deep and opaquely on a bad spec (an unknown component surfaces
 * as a null dereference), so an author is better served by the catalog's account
 * of what is wrong.
 */
export const prepareReportSpec = (
  spec: Spec,
  branding: ReportBranding = {},
  outputSchema?: JSONSchema._JSONSchema,
): Spec => {
  if (!isReportSpec(spec)) {
    throw new Error('A PDF report template must contain a valid json-render spec');
  }

  const issues = validateReportSpec(spec, outputSchema);
  if (issues.length > 0) {
    throw new Error(`Invalid report template — ${formatReportSpecIssues(issues)}`);
  }

  return applyReportBranding(spec, branding);
};
