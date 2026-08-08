import type { ReportBranding, ReportTemplate } from './types';

/**
 * Where the host app mounts its render route. Overridable so the package never
 * hardcodes one app's routing — see the package README for the contract.
 */
export const DEFAULT_RENDER_ENDPOINT = '/api/pdf-report';

export type FetchReportPdfOptions = {
  template: ReportTemplate;
  /** Real values for the report; defaults to the template's `demoInput`. */
  input?: unknown;
  branding?: ReportBranding;
  filename?: string;
  endpoint?: string;
  signal?: AbortSignal;
};

/**
 * Posts a template to the render route and returns the PDF bytes.
 *
 * Both the editor preview and any download button go through here, so the
 * request shape is defined once.
 */
export const fetchReportPdf = async ({
  template,
  input,
  branding,
  filename,
  endpoint = DEFAULT_RENDER_ENDPOINT,
  signal,
}: FetchReportPdfOptions): Promise<Blob> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ template, input, branding, filename }),
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? 'Failed to render the PDF');
  }

  return response.blob();
};
