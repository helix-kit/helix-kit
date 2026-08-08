import {
  applySpecStreamPatch,
  createMixedStreamParser,
  createSpecStreamCompiler,
  type Spec,
  type SpecStreamCompiler,
} from '@json-render/core';

export type { SpecStreamCompiler };

/**
 * Compiles a generation stream into a spec.
 *
 * A model emits SpecStream — JSONL patch operations, one per line — rather than
 * a whole document, so the caller pushes chunks as they arrive and reads the
 * progressively built spec back out. Seed it with the current spec to refine
 * one, or leave it empty to generate from scratch.
 *
 * Re-exported so a host consuming `/api/pdf-report/generate` does not have to
 * depend on `@json-render/core` itself.
 */
export const createReportStreamCompiler = (initial?: Spec | null): SpecStreamCompiler<Spec> =>
  createSpecStreamCompiler<Spec>(initial === null || initial === undefined ? {} : { ...initial });

export type ReportStreamReader = {
  /** Push a chunk as it arrives. */
  push: (chunk: string) => void;
  /** Flush the trailing partial line. Call once the stream ends. */
  flush: () => void;
  /** The spec built so far. */
  spec: () => Spec;
  /** How many patches have been applied. */
  patchCount: () => number;
  /** Lines that were not patches, joined — a model's prose, or a relayed error. */
  text: () => string;
};

/**
 * Reads a generation stream that may mix prose with patches.
 *
 * A model is not obliged to emit only JSONL: it may narrate, wrap patches in a
 * ```spec fence, or — when the request failed — the route may relay an error as
 * plain text. `createSpecStreamCompiler` alone silently drops all of that, which
 * turns a failed generation into an empty spec with no explanation. Pairing the
 * mixed parser with `applySpecStreamPatch` keeps both halves: patches build the
 * spec, everything else is retained as text for the caller to surface.
 */
export const createReportStreamReader = (initial?: Spec | null): ReportStreamReader => {
  const spec = (initial === null || initial === undefined ? {} : { ...initial }) as Spec;
  const prose: string[] = [];
  let patches = 0;

  const parser = createMixedStreamParser({
    onPatch: (patch) => {
      patches += 1;
      applySpecStreamPatch(spec as unknown as Record<string, unknown>, patch);
    },
    onText: (line) => {
      prose.push(line);
    },
  });

  return {
    push: (chunk) => {
      parser.push(chunk);
    },
    flush: () => {
      parser.flush();
    },
    spec: () => spec,
    patchCount: () => patches,
    text: () => prose.join('\n').trim(),
  };
};
