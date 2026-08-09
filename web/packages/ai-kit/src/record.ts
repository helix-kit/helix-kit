import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';

/** The resolved form; `LanguageModel` also admits a bare id string, which cannot be wrapped. */
type WrappableModel = Exclude<LanguageModel, string>;

/**
 * One model call of a turn: what went in, and every part that came back.
 *
 * The parts are stored exactly as the provider emitted them. Replaying anything
 * less than that — a summary, the final text — would replay a different stream
 * than the one the UI has to cope with, which is the opposite of the point.
 */
type RecordedCall = {
  params: unknown;
  parts: unknown[];
};

export type Recording = {
  /** What was asked for, so a fixture can be recognised without reading its parts. */
  prompt: string;
  model: string;
  recordedAt: string;
  calls: RecordedCall[];
};

/**
 * Wraps a model so every call of a turn is written to a fixture.
 *
 * An agent loop is many model calls, not one, and the interesting behaviour is
 * in their sequence. The whole turn goes to a single file, appended as each call
 * completes, so a turn that is interrupted still leaves a usable fixture of what
 * happened before it stopped.
 */
export const recordingModel = (
  model: WrappableModel,
  options: { path: string; prompt: string; modelId: string },
): WrappableModel => {
  const { path, prompt, modelId } = options;
  // Built here, not spread from a shared constant: one `calls` array reused
  // across recordings would collect every turn the process ever made.
  const recording: Recording = {
    prompt,
    model: modelId,
    recordedAt: new Date().toISOString(),
    calls: [],
  };

  let rotated = false;
  const flush = () => {
    mkdirSync(dirname(path), { recursive: true });
    // The turn being replaced is often the one being debugged, and a real run
    // started by accident should not be the end of it. Kept one generation back,
    // once per recording rather than once per call, so the copy is the previous
    // turn and not this one half-written.
    if (!rotated) {
      rotated = true;
      if (existsSync(path)) {
        copyFileSync(path, previousPath(path));
      }
    }
    writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`);
  };

  const middleware: LanguageModelMiddleware = {
    wrapStream: async ({ doStream, params }) => {
      const { stream, ...rest } = await doStream();
      const parts: unknown[] = [];

      return {
        ...rest,
        stream: stream.pipeThrough(
          new TransformStream({
            transform: (part, controller) => {
              parts.push(part);
              controller.enqueue(part);
            },
            flush: () => {
              recording.calls.push({ params, parts });
              flush();
            },
          }),
        ),
      };
    },
  };

  return wrapLanguageModel({ model, middleware });
};

/** Where the turn a recording displaced is kept. */
const previousPath = (path: string): string => path.replace(/\.json$/, '.previous.json');

export const readRecording = (path: string): Recording =>
  JSON.parse(readFileSync(path, 'utf8')) as Recording;

/**
 * A model that replays a recording instead of calling a provider.
 *
 * Calls are served in the order they were recorded, ignoring what is asked of
 * them. That is deliberate: on replay the tools run for real, so their results —
 * timestamps, ids, whatever the sandbox computes — will differ from the recorded
 * run, and the recorded params will not match the new ones. Matching on them
 * would make the fixture unusable for the thing it exists for, which is watching
 * the same stream drive the UI again.
 *
 * Running out of recorded calls throws rather than returning something empty: a
 * loop that goes further than the recording did is a real difference, and it
 * should be visible instead of ending in a silent stop.
 */
export const replayModel = (recording: Recording, options: { chunkDelayMs?: number } = {}) => {
  const { chunkDelayMs = 8 } = options;
  let next = 0;

  return new MockLanguageModelV4({
    provider: 'helix.replay',
    modelId: recording.model,
    doStream: async () => {
      const call = recording.calls[next];
      if (call === undefined) {
        throw new Error(
          `The recording has ${String(recording.calls.length)} call(s); the run asked for ${String(next + 1)}. Re-record it.`,
        );
      }
      next += 1;

      return {
        stream: simulateReadableStream({
          chunks: call.parts as never[],
          chunkDelayInMs: chunkDelayMs,
        }),
      };
    },
  });
};
