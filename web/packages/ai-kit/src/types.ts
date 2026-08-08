import type { JSONSchema } from 'zod/v4/core';

/**
 * One named piece of a system prompt.
 *
 * Named rather than concatenated because prompts here are assembled from
 * several packages, and a host frequently needs to change exactly one part of
 * what a capability says about itself — the site assistant teaching the code
 * executor about its host functions, say — without restating the rest. An id
 * gives it something to aim at.
 */
export type PromptSection = {
  id: string;
  title: string;
  body: string;
};

/**
 * A tool a capability offers the model, described without reference to any
 * provider.
 *
 * The host adapts these to whichever SDK it runs, which keeps model invocation,
 * auth and metering in the application rather than spread across the packages
 * that merely describe what can be done.
 */
export type AiToolDescriptor = {
  /** Model-safe and unique across the composed assistant. */
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: JSONSchema.JSONSchema;
  /** May be async; the host awaits the result. */
  execute: (input: unknown) => unknown;
};

/**
 * How a produced artifact reaches its destination.
 *
 * `replace` swaps the whole value; `jsonl-patch` is a stream of newline-delimited
 * operations applied in order, which is what lets a long document appear
 * progressively instead of arriving all at once at the end.
 */
export type ArtifactMode = 'replace' | 'jsonl-patch';

/**
 * A typed output the model can produce.
 *
 * Artifacts are addressed by kind so a host can route each one to the place it
 * belongs — a specific editor pane — while it is still streaming, rather than
 * picking the pieces out of prose once the turn is over.
 */
export type ArtifactSpec = {
  kind: string;
  description: string;
  /** Shape of the artifact's value, when it has a fixed one. */
  schema?: JSONSchema.JSONSchema;
  mode: ArtifactMode;
};

/**
 * Everything one piece of the system contributes to an assistant working with it.
 *
 * A capability is produced by the package that owns the subject, so the
 * explanation, the checks and the outputs stay next to the thing they describe
 * and cannot drift from it.
 */
export type AiCapability = {
  id: string;
  sections: PromptSection[];
  tools: AiToolDescriptor[];
  artifacts: ArtifactSpec[];
};

/** What a host gets back after composing capabilities into one assistant. */
export type ComposedAssistant = {
  /** The assembled system prompt. */
  system: string;
  sections: PromptSection[];
  tools: AiToolDescriptor[];
  artifacts: ArtifactSpec[];
};
