import { renderToBuffer, standardComponents } from '@json-render/react-pdf/render';

import { helixPdfComponents } from './components/registry';
import { isReportSpec } from './document';
import { cloneJson } from './json';

import type { ReportBranding } from './types';
import type { Spec, UIElement } from '@json-render/core';

const PAGE_TYPE = 'Page';
const REPORT_PAGE_TYPE = 'ReportPage';

/** Every component a template may name — the stock catalog plus this pack. */
export const knownComponentTypes: readonly string[] = [
  ...new Set([...Object.keys(standardComponents), ...Object.keys(helixPdfComponents)]),
].sort();

/**
 * Reports a misspelled component up front. Without this the renderer fails deep
 * inside react-pdf with an opaque null dereference, which tells a template
 * author nothing about which element is wrong.
 */
const assertKnownComponents = (spec: Spec): void => {
  const unknown = [
    ...new Set(
      Object.values(spec.elements as Record<string, UIElement>)
        .map((element) => element.type)
        .filter((type) => !knownComponentTypes.includes(type)),
    ),
  ];

  if (unknown.length > 0) {
    throw new Error(
      `Unknown component type(s): ${unknown.join(', ')}. Available: ${knownComponentTypes.join(', ')}`,
    );
  }
};

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
    };
  }

  return next;
};

/**
 * Renders a report PDF: the Helix component pack plus auto-injected,
 * non-removable page branding.
 */
export const renderReportToBuffer = async (
  spec: Spec,
  data?: Record<string, unknown>,
  branding: ReportBranding = {},
): Promise<Uint8Array> => {
  if (!isReportSpec(spec)) {
    throw new Error('A PDF report template must contain a valid json-render spec');
  }

  assertKnownComponents(spec);

  return renderToBuffer(applyReportBranding(spec, branding), {
    registry: helixPdfComponents,
    state: data,
  });
};
