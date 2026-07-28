import { randomUUID } from 'node:crypto';

import { workflowRunResult } from './result-table';
import {
  type NodeContext,
  type NodeOutput,
  type WorkflowDeps,
  type WorkflowTriggerData,
} from './types';

const RECENT_EVENT_COUNT = 10;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Terminal record for one run — the load test's throughput/latency hook. Written
// by the notify node on completion and by the executor when the gate skips a run.
export const writeWorkflowResult = async (
  deps: WorkflowDeps,
  data: WorkflowTriggerData,
  status: 'completed' | 'skipped',
): Promise<void> => {
  await deps.db.insert(workflowRunResult).values({
    id: randomUUID(),
    runId: data.runId ?? 'unknown',
    deviceId: data.deviceId,
    messageId: data.messageId,
    emittedAtNs: data.emittedAtNs,
    status,
    mode: deps.mode,
  });
};

// ---- node handlers -------------------------------------------------------
// Each returns a plain object merged into downstream nodes' inputs. Async nodes
// block for their configured fake latency to model real I/O without real infra.

const triggerNode = ({ data }: NodeContext): NodeOutput => ({
  deviceId: data.deviceId,
  metric: data.metric,
});

// Pure/sync: pretend to derive a normalized reading from the raw event.
const normalizeNode = ({ inputs }: NodeContext): NodeOutput => {
  const metric = typeof inputs.metric === 'number' ? inputs.metric : 0;
  return { normalizedMetric: metric, bucket: metric % 2 === 0 ? 'even' : 'odd' };
};

// The if/else gate. Passes when the metric clears the threshold; otherwise halts
// the run before any of the expensive async work.
const thresholdGateNode = ({ inputs, deps }: NodeContext): NodeOutput => {
  const metric = typeof inputs.normalizedMetric === 'number' ? inputs.normalizedMetric : 0;
  const passed = metric >= deps.gateThreshold;
  return { passed, halt: !passed };
};

// Async, fast: fake "SELECT ... last 10 events for this device".
const queryDeviceEventsNode = async ({ data, deps }: NodeContext): Promise<NodeOutput> => {
  await sleep(deps.timings.queryEventsMs);
  const recent = Array.from({ length: RECENT_EVENT_COUNT }, (_, index) => ({
    seq: data.metric - index,
    deviceId: data.deviceId,
  }));
  return { recentEvents: recent, recentCount: recent.length };
};

// Async, slow (~5s): fake LLM summarization of the recent events.
const llmSummarizeNode = async ({ inputs, deps }: NodeContext): Promise<NodeOutput> => {
  await sleep(deps.timings.summarizeMs);
  const count = typeof inputs.recentCount === 'number' ? inputs.recentCount : 0;
  return { summary: `Summarized ${count} recent events.` };
};

// Async, fast: fake notification/email delivery, then record the terminal result.
const sendNotificationNode = async ({ data, deps }: NodeContext): Promise<NodeOutput> => {
  await sleep(deps.timings.notifyMs);
  await writeWorkflowResult(deps, data, 'completed');
  return { delivered: true };
};

export type NodeHandler = (ctx: NodeContext) => NodeOutput | Promise<NodeOutput>;

// Maps a node's `type` to its implementation. Keeping the registry data-driven
// lets the executor walk any graph shape, not just this one hardcoded path.
export const NODE_HANDLERS: Readonly<Record<string, NodeHandler>> = {
  trigger: triggerNode,
  normalize: normalizeNode,
  'threshold-gate': thresholdGateNode,
  'query-device-events': queryDeviceEventsNode,
  'llm-summarize': llmSummarizeNode,
  'send-notification': sendNotificationNode,
};
