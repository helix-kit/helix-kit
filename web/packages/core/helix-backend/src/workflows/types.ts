import { type Logger } from '@helix/logger';

import { type DatabaseClient } from '../db';

// One node in a workflow graph. `kind` decides how the executor schedules it:
// `sync` nodes are pure/fast and get batched with their neighbours into a single
// durable step; `async` nodes each get their own durable step (the Inngest
// checkpoint boundary that makes the run resumable — and the source of the
// "durable workflow tax" the load test quantifies).
export type WorkflowNodeKind = 'sync' | 'async';

export type WorkflowNode = Readonly<{
  id: string;
  type: string;
  kind: WorkflowNodeKind;
  config?: Record<string, unknown>;
}>;

export type WorkflowEdge = Readonly<{ source: string; target: string }>;

export type WorkflowGraph = Readonly<{
  nodes: readonly WorkflowNode[];
  edges: readonly WorkflowEdge[];
}>;

// The event payload that triggers a workflow run — the essentials the dispatch
// role lifts off an ingested device event. `metric` is the value the if/else
// gate inspects; `runId`/`emittedAtNs` are the load-test attribution hooks.
export type WorkflowTriggerData = Readonly<{
  deviceId: string;
  messageId: string;
  runId: string | null;
  emittedAtNs: string | null;
  metric: number;
}>;

export type WorkflowRunMode = 'inngest' | 'direct' | 'dbos';

// Fake latencies for the async nodes so the graph models a realistic mix without
// real infra: a fast DB read, a slow (LLM-like) summarize, a fast notify.
export type WorkflowTimings = Readonly<{
  queryEventsMs: number;
  summarizeMs: number;
  notifyMs: number;
}>;

// How the summarize node models the LLM call. 'blocking' runs a fake in-worker
// sleep inside step.run (holds a durable-step slot for its duration). 'infer'
// uses step.ai.infer, Inngest's recommended AI primitive, which offloads the
// request to the Inngest server and parks the run during the wait (frees the
// slot) — pointed here at a fake OpenAI-compatible endpoint.
export type WorkflowLlmMode = 'blocking' | 'infer';

export type WorkflowDeps = Readonly<{
  db: DatabaseClient;
  mode: WorkflowRunMode;
  timings: WorkflowTimings;
  // Gate passes when metric >= threshold. Default 0 (device seq >= 0 always
  // passes) runs the full path for every event; raise it to exercise skips.
  gateThreshold: number;
  llmMode: WorkflowLlmMode;
  // For llmMode 'infer': the OpenAI-compatible base URL and model name Inngest
  // should call. baseUrl has no /chat/completions suffix (the adapter adds it).
  inferBaseUrl?: string;
  inferModel?: string;
  logger?: Logger;
}>;

export type NodeContext = Readonly<{
  data: WorkflowTriggerData;
  inputs: Record<string, unknown>;
  deps: WorkflowDeps;
}>;

// A node's output is merged into downstream nodes' `inputs`. `halt` short-circuits
// the run (the if/else gate uses it) and is recorded as a 'skipped' result.
export type NodeOutput = Record<string, unknown> & { halt?: boolean };

export type WorkflowRunOutcome = Readonly<{ status: 'completed' | 'skipped' }>;
