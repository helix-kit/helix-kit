import type { ArtifactSpec } from './types';

/**
 * What a host emits as an artifact is produced.
 *
 * Artifacts travel as their own events rather than as text the client digs
 * through afterwards, so each one can be routed to its destination while the
 * turn is still running.
 */
export type ArtifactEvent =
  /** A whole value, for `replace` artifacts. */
  | { type: 'artifact-value'; kind: string; value: unknown }
  /** Discard what was built so far: what follows is a replacement, not an edit. */
  | { type: 'artifact-reset'; kind: string }
  /** A fragment of a `jsonl-patch` artifact. Boundaries are arbitrary. */
  | { type: 'artifact-delta'; kind: string; chunk: string }
  /** No more of this artifact is coming. */
  | { type: 'artifact-end'; kind: string };

export type ArtifactHandlers = {
  /** A complete value arrived for a `replace` artifact. */
  onValue?: (kind: string, value: unknown) => void;
  /** One complete line of a `jsonl-patch` artifact. */
  onPatchLine?: (kind: string, line: string) => void;
  /** Start this artifact over; the patches that follow build from nothing. */
  onReset?: (kind: string) => void;
  onEnd?: (kind: string) => void;
  /** An event that does not match the artifact table. */
  onUnknown?: (kind: string, reason: string) => void;
};

export type ArtifactCollector = {
  handle: (event: ArtifactEvent) => void;
  /**
   * Applies whatever is still buffered, for a source that stops without saying so.
   *
   * A patch artifact holds its trailing partial line waiting for the newline that
   * completes it. If the stream simply ends — a model that never sets `done` —
   * that line is otherwise lost, and losing the *last* line of a patch is losing
   * the one most likely to attach everything before it to the document.
   */
  flush: () => void;
};

/**
 * Turns a stream of artifact events into whole values and whole patch lines.
 *
 * The buffering is the point. Deltas break wherever the transport happens to
 * split them, which lands mid-line often enough that a consumer parsing each
 * chunk on its own would corrupt roughly every long artifact — so a partial
 * trailing line is held back until the rest of it arrives.
 *
 * Events naming a kind outside the artifact table are reported rather than
 * applied: a model inventing a destination should not silently write somewhere.
 */
export const createArtifactCollector = (
  artifacts: ArtifactSpec[],
  handlers: ArtifactHandlers,
): ArtifactCollector => {
  const byKind = new Map(artifacts.map((artifact) => [artifact.kind, artifact]));
  const buffers = new Map<string, string>();

  const flushLines = (kind: string, incoming: string, includeTrailing: boolean) => {
    const pending = (buffers.get(kind) ?? '') + incoming;
    const lines = pending.split('\n');
    const trailing = includeTrailing ? '' : (lines.pop() ?? '');
    buffers.set(kind, trailing);

    for (const line of lines) {
      if (line.trim().length > 0) {
        handlers.onPatchLine?.(kind, line);
      }
    }
  };

  return {
    flush: () => {
      for (const kind of [...buffers.keys()]) {
        flushLines(kind, '', true);
        buffers.delete(kind);
      }
    },
    handle: (event) => {
      const spec = byKind.get(event.kind);
      if (spec === undefined) {
        handlers.onUnknown?.(event.kind, 'not a declared artifact kind');
        return;
      }

      if (event.type === 'artifact-reset') {
        buffers.delete(event.kind);
        handlers.onReset?.(event.kind);
        return;
      }

      if (event.type === 'artifact-value') {
        if (spec.mode !== 'replace') {
          handlers.onUnknown?.(event.kind, `expected ${spec.mode} deltas, got a whole value`);
          return;
        }
        handlers.onValue?.(event.kind, event.value);
        return;
      }

      if (event.type === 'artifact-delta') {
        if (spec.mode !== 'jsonl-patch') {
          handlers.onUnknown?.(event.kind, `expected a whole value, got a delta`);
          return;
        }
        flushLines(event.kind, event.chunk, false);
        return;
      }

      if (spec.mode === 'jsonl-patch') {
        // The last line usually arrives without its newline.
        flushLines(event.kind, '', true);
        buffers.delete(event.kind);
      }
      handlers.onEnd?.(event.kind);
    },
  };
};
