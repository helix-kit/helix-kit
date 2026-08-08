import type { Spec } from '@json-render/core';

/** The json-render element graph a template is made of. */
export type ReportSpec = Spec;

/**
 * A report template: the json-render spec plus the sample data the editor
 * previews it against. Runtime callers supply their own data of the same shape.
 */
export type ReportDocument = {
  spec: Spec;
  demoData: Record<string, unknown>;
};

/**
 * Branding stamped onto every page. Supplied by the caller, never by the
 * template author — see `renderReportToBuffer`.
 */
export type ReportBranding = {
  /** Report name, shown top-right of every page. */
  title?: string;
  /** Secondary line under the title (e.g. fleet / device / window). */
  subtitle?: string;
  /** Human-readable generation timestamp for the footer. */
  generatedAt?: string;
  /** Overrides the default "Generated <generatedAt>" footer text. */
  footerNote?: string;
};
