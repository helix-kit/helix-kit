import { type Logger } from '@helix/logger';

import { type DatabaseClient } from '../db';

// 'sync' nodes batch into one durable step; 'async' nodes each get their own (the Inngest checkpoint boundary).
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

// Event payload that triggers a workflow run; `metric` feeds the if/else gate, `runId`/`emittedAtNs` are load-test attribution hooks.
export type WorkflowTriggerData = Readonly<{
  deviceId: string;
  messageId: string;
  runId: string | null;
  emittedAtNs: string | null;
  metric: number;
}>;

export type WorkflowRunMode = 'inngest' | 'direct' | 'dbos';

// Fake latencies for the async nodes, modeling a realistic mix without real infra.
export type WorkflowTimings = Readonly<{
  queryEventsMs: number;
  summarizeMs: number;
  notifyMs: number;
}>;

// 'blocking' sleeps inside step.run (holds the durable-step slot); 'infer' uses step.ai.infer, which parks the run and frees it.
export type WorkflowLlmMode = 'blocking' | 'infer';

export type WorkflowDeps = Readonly<{
  db: DatabaseClient;
  mode: WorkflowRunMode;
  timings: WorkflowTimings;
  // Gate passes when metric >= threshold; default 0 runs the full path for every event.
  gateThreshold: number;
  llmMode: WorkflowLlmMode;
  // For llmMode 'infer'; baseUrl has no /chat/completions suffix (the adapter adds it).
  inferBaseUrl?: string;
  inferModel?: string;
  logger?: Logger;
}>;

export type NodeContext = Readonly<{
  data: WorkflowTriggerData;
  inputs: Record<string, unknown>;
  deps: WorkflowDeps;
}>;

// A node's output is merged into downstream nodes' `inputs`; `halt` short-circuits the run as 'skipped'.
export type NodeOutput = Record<string, unknown> & { halt?: boolean };

export type WorkflowRunOutcome = Readonly<{ status: 'completed' | 'skipped' }>;
