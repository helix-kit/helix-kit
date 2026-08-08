import { buildUserPrompt, type Spec } from '@json-render/core';

import { reportCatalog } from './catalog';

export type ReportGenerationPrompt = {
  /** Describes every available component and its props. */
  system: string;
  /** The user's request, wrapped with the conventions the model is expected to follow. */
  user: string;
};

/**
 * Builds the prompt pair for generating or refining a template.
 *
 * Both halves come from the catalog rather than a hand-maintained description,
 * so a model is always told the vocabulary that actually exists. Passing
 * `currentSpec` switches the model into patch-only mode, which is how a refine
 * differs from a fresh generation.
 *
 * Exists so a host wiring up generation does not have to depend on
 * `@json-render/core` itself.
 */
export const buildReportGenerationPrompt = ({
  prompt,
  currentSpec = null,
}: {
  prompt: string;
  currentSpec?: Spec | null;
}): ReportGenerationPrompt => ({
  system: reportCatalog.prompt(),
  user: buildUserPrompt({ prompt, currentSpec }),
});
