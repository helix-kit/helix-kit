import { type WorkflowGraph, type WorkflowNode } from './types';

const syncNode = (id: string, type: string): WorkflowNode => ({ id, type, kind: 'sync' });
const asyncNode = (id: string, type: string): WorkflowNode => ({ id, type, kind: 'async' });

// The hardcoded device-event automation used by the load test. Six nodes,
// three sync (batched into one durable step) then three async (one durable step
// each), modelling: event arrives -> normalize + if/else gate -> query the
// device's recent events (fast) -> summarize with an LLM (slow, ~5s) -> deliver
// a notification (fast, and record the terminal result).
//
//   trigger ─> normalize ─> gate ─> query-events ─> summarize ─> notify
//   └────────── sync chain ────────┘ └──────────── async steps ───────────┘
// Node ids, named once so each literal is not duplicated across nodes + edges.
const ID = {
  trigger: 'trigger',
  normalize: 'normalize',
  gate: 'gate',
  query: 'query-events',
  summarize: 'summarize',
  notify: 'notify',
} as const;

export const DEVICE_EVENT_WORKFLOW: WorkflowGraph = {
  nodes: [
    syncNode(ID.trigger, 'trigger'),
    syncNode(ID.normalize, 'normalize'),
    syncNode(ID.gate, 'threshold-gate'),
    asyncNode(ID.query, 'query-device-events'),
    asyncNode(ID.summarize, 'llm-summarize'),
    asyncNode(ID.notify, 'send-notification'),
  ],
  edges: [
    { source: ID.trigger, target: ID.normalize },
    { source: ID.normalize, target: ID.gate },
    { source: ID.gate, target: ID.query },
    { source: ID.query, target: ID.summarize },
    { source: ID.summarize, target: ID.notify },
  ],
};
