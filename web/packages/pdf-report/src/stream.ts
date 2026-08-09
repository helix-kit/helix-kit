import { applySpecStreamPatch, createMixedStreamParser, type Spec } from '@json-render/core';

import { cloneJson } from './json';

/** The only two things a layout has at its top level. */
const SPEC_ROOTS = ['/root', '/elements'];

/**
 * Refuses a path that is not rooted at the layout.
 *
 * Paths address the layout, not the template that holds it, and a model shown
 * the whole template naturally writes `/spec/elements/...`. Left alone that is
 * far worse than an error: a `remove` at an unknown path does nothing at all,
 * and a `replace` invents the missing parents, so the layout grows a `spec` key
 * containing a second half-layout. Nothing fails, nothing changes, and the model
 * reports that it removed something it did not.
 */
const assertSpecPath = (path: string): void => {
  if (!SPEC_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))) {
    throw new Error(
      `Patch path "${path}" is not part of the layout. Paths are rooted at the layout itself, so they start with "/elements" or "/root" — for example "/elements/page/children/0", not "/spec/elements/...".`,
    );
  }
};

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
      assertSpecPath(patch.path);
      applySpecStreamPatch(next, patch);
    },
    onText: () => {},
  });

  parser.push(`${line}\n`);
  parser.flush();

  return next as unknown as Spec;
};
