import type { Spec } from '@json-render/core';
import type { JSONSchema } from 'zod/v4/core';

/** The json-render element graph a template renders through. */
export type ReportSpec = Spec;

/**
 * A report template, in two tiers.
 *
 * The `code` step does the work — aggregating, filtering, grouping, formatting —
 * and produces exactly the values `spec` binds to. The components downstream
 * compute nothing, so the two schemas are the whole contract between the tiers:
 * `inputSchema` is what a caller must supply, `outputSchema` is what the
 * presentation may rely on.
 */
export type ReportTemplate = {
  /** What the report is handed. Also types `input` in the code editor. */
  inputSchema: JSONSchema._JSONSchema;
  /** TypeScript: the body of a function over `input` that returns the output. */
  code: string;
  /** What the code produces, and therefore what `spec` may bind to. */
  outputSchema: JSONSchema._JSONSchema;
  /** Presentation only. */
  spec: ReportSpec;
  /** Sample input for the editor preview, valid against `inputSchema`. */
  demoInput: unknown;
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
