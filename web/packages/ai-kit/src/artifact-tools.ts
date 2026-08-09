import type { ArtifactEvent } from './artifact-stream';
import type { AiToolDescriptor, ArtifactSpec } from './types';
import type { JSONSchema } from 'zod/v4/core';

/** Turns a kind into a tool name: `report.inputSchema` → `write_report_input_schema`. */
const toolNameFor = (kind: string): string =>
  `write_${kind
    .replace(/[.\-/]/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()}`;

export type ArtifactEmitter = (event: ArtifactEvent) => void;

/**
 * Exposes each artifact as a tool the model calls to produce it.
 *
 * Artifacts are written through tools rather than parsed out of the reply for
 * two reasons. A tool call carries a schema, so a malformed artifact is rejected
 * where the model can still fix it; and it arrives as a discrete event, so the
 * host knows which of five panes to update without guessing from context.
 *
 * A `jsonl-patch` artifact may be written repeatedly — each call appends — which
 * is what lets a long layout appear as it is composed. Its `done` flag closes the
 * artifact, flushing any line still waiting for its newline.
 */
export const artifactTools = (
  artifacts: ArtifactSpec[],
  emit: ArtifactEmitter,
): AiToolDescriptor[] =>
  artifacts.map((artifact): AiToolDescriptor => {
    const patching = artifact.mode === 'jsonl-patch';

    const parameters: JSONSchema.JSONSchema = patching
      ? {
          type: 'object',
          properties: {
            patch: { type: 'string', description: 'Newline-delimited patch operations.' },
            done: { type: 'boolean', description: 'True when nothing further follows.' },
            replaces: {
              type: 'boolean',
              description:
                'True when this is a complete replacement rather than an edit to what exists. Set it when writing the whole thing from scratch.',
            },
          },
          required: ['patch'],
          additionalProperties: false,
        }
      : {
          type: 'object',
          properties: {
            // Typed even when the artifact has no schema of its own: an argument
            // with no declared type is what invites a provider to send an object
            // as a JSON string.
            value: artifact.schema ?? {
              anyOf: [
                { type: 'object' },
                { type: 'array' },
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
              ],
              description: 'The whole value.',
            },
          },
          required: ['value'],
          additionalProperties: false,
        };

    return {
      name: toolNameFor(artifact.kind),
      description: patching
        ? `${artifact.description} Send newline-delimited patch operations; call again to append, set replaces when writing the whole thing from scratch, and set done when it is complete.`
        : `${artifact.description} Sends the whole value, replacing anything written before.`,
      parameters,
      execute: (raw) => {
        if (patching) {
          const { patch, done, replaces } = raw as {
            patch: string;
            done?: boolean;
            replaces?: boolean;
          };
          if (replaces === true) {
            emit({ type: 'artifact-reset', kind: artifact.kind });
          }
          // Terminated here because a tool call is a complete message, not a
          // network fragment. Without this the last operation sits in the
          // collector's buffer waiting for a newline that never comes, and a
          // model that does not set `done` silently loses it.
          emit({
            type: 'artifact-delta',
            kind: artifact.kind,
            chunk: patch.endsWith('\n') ? patch : `${patch}\n`,
          });
          if (done === true) {
            emit({ type: 'artifact-end', kind: artifact.kind });
          }
          return { written: true };
        }

        const { value } = raw as { value: unknown };
        emit({ type: 'artifact-value', kind: artifact.kind, value });
        emit({ type: 'artifact-end', kind: artifact.kind });
        return { written: true };
      },
    };
  });
