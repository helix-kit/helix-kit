import { applySpecStreamPatch, createMixedStreamParser, type Spec } from '@json-render/core';

import { cloneJson } from './json';

/**
 * Applies one SpecStream line to a spec, returning the result.
 *
 * A host receiving whole lines — because an artifact stream delimited them —
 * applies each as it lands rather than accumulating text and recompiling. A line
 * that is not a patch is ignored, since prose shares the channel.
 *
 * The spec is deep-copied, not spread. A patch writes into nested paths like
 * `/elements/card/props`, so a shallow copy would reach through into the
 * caller's own objects: every previously rendered spec would change under it,
 * and a template used as a starting point — the default one, say — would be
 * quietly rewritten for the rest of the process.
 */
export const applyReportPatchLine = (spec: Spec, line: string): Spec => {
  const next = cloneJson(spec) as unknown as Record<string, unknown>;
  const parser = createMixedStreamParser({
    onPatch: (patch) => {
      applySpecStreamPatch(next, patch);
    },
    onText: () => {},
  });

  parser.push(`${line}\n`);
  parser.flush();

  return next as unknown as Spec;
};
