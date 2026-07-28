import { NODE_HANDLERS, writeWorkflowResult } from './nodes';
import {
  type NodeOutput,
  type WorkflowDeps,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowRunOutcome,
  type WorkflowTriggerData,
} from './types';

// Minimal subset of Inngest's step API the executor needs. `run` memoizes its
// result and re-executes only until the next new step on each replay, so each
// call is one durable checkpoint (a write to Inngest's Postgres state store).
// `ai.infer` offloads a provider request to the Inngest server and parks the run
// during it (the recommended AI primitive), so the wait holds no execution slot.
export type StepTools = Readonly<{
  run: <T>(id: string, handler: () => Promise<T> | T) => Promise<T>;
}>;

type AiStep = Readonly<{
  ai: {
    infer: (id: string, opts: { model: unknown; body: unknown }) => Promise<unknown>;
    models: { openai: (config: { model: string; baseUrl?: string; apiKey?: string }) => unknown };
  };
}>;

const SUMMARIZE_NODE_TYPE = 'llm-summarize';

// Run the summarize node via step.ai.infer against the (fake) OpenAI-compatible
// endpoint. Inngest makes the call and parks the run during it.
const runInferSummarize = async (
  step: StepTools,
  node: WorkflowNode,
  deps: WorkflowDeps,
): Promise<NodeOutput> => {
  const { ai } = step as unknown as AiStep;
  const model = deps.inferModel ?? 'fake';
  const response = (await ai.infer(`node-${node.id}`, {
    model: ai.models.openai({ model, baseUrl: deps.inferBaseUrl, apiKey: 'sk-fake' }),
    body: {
      model,
      messages: [{ role: 'user', content: 'Summarize the recent events for this device.' }],
    },
  })) as { choices?: Array<{ message?: { content?: string } }> };
  const summary = response.choices?.[0]?.message?.content ?? 'summarized';
  return { summary, inferred: true };
};

type Unit = Readonly<{ async: boolean; nodes: readonly WorkflowNode[] }>;

// Kahn topological sort over the edge list; throws on a cycle so a malformed
// graph fails loudly rather than hanging.
const topologicalOrder = (graph: WorkflowGraph): WorkflowNode[] => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const queue = graph.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((n) => n.id);
  const order: WorkflowNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const node = byId.get(id);
    if (node !== undefined) {
      order.push(node);
    }
    for (const edge of graph.edges) {
      if (edge.source !== id) {
        continue;
      }
      const next = (indegree.get(edge.target) ?? 0) - 1;
      indegree.set(edge.target, next);
      if (next === 0) {
        queue.push(edge.target);
      }
    }
  }
  if (order.length !== graph.nodes.length) {
    throw new Error('workflow graph has a cycle');
  }
  return order;
};

// Group consecutive sync nodes into one chain unit (a single durable step) and
// give each async node its own unit (its own durable step) — the sync/async
// scheduling split that mirrors the real engine.
const planUnits = (graph: WorkflowGraph): Unit[] => {
  const units: Unit[] = [];
  let chain: WorkflowNode[] = [];
  for (const node of topologicalOrder(graph)) {
    if (node.kind === 'async') {
      if (chain.length > 0) {
        units.push({ async: false, nodes: chain });
        chain = [];
      }
      units.push({ async: true, nodes: [node] });
    } else {
      chain.push(node);
    }
  }
  if (chain.length > 0) {
    units.push({ async: false, nodes: chain });
  }
  return units;
};

const collectInputs = (
  graph: WorkflowGraph,
  nodeId: string,
  results: Record<string, NodeOutput>,
): Record<string, unknown> => {
  const inputs: Record<string, unknown> = {};
  for (const edge of graph.edges) {
    if (edge.target === nodeId) {
      Object.assign(inputs, results[edge.source] ?? {});
    }
  }
  return inputs;
};

const executeNode = async (
  graph: WorkflowGraph,
  node: WorkflowNode,
  results: Record<string, NodeOutput>,
  data: WorkflowTriggerData,
  deps: WorkflowDeps,
): Promise<NodeOutput> => {
  const handler = NODE_HANDLERS[node.type];
  if (handler === undefined) {
    throw new Error(`no handler registered for node type "${node.type}"`);
  }
  return handler({ data, inputs: collectInputs(graph, node.id, results), deps });
};

// Runs a sync chain in one shot against a local copy of the results (so
// intra-chain dependencies resolve), returning the produced outputs and whether
// the if/else gate halted the run.
const executeChain = async (
  graph: WorkflowGraph,
  nodes: readonly WorkflowNode[],
  results: Record<string, NodeOutput>,
  data: WorkflowTriggerData,
  deps: WorkflowDeps,
): Promise<{ outputs: Record<string, NodeOutput>; halted: boolean }> => {
  const local: Record<string, NodeOutput> = { ...results };
  const outputs: Record<string, NodeOutput> = {};
  for (const node of nodes) {
    const output = await executeNode(graph, node, local, data, deps);
    local[node.id] = output;
    outputs[node.id] = output;
    if (output.halt === true) {
      return { outputs, halted: true };
    }
  }
  return { outputs, halted: false };
};

// Executes the graph through Inngest's durable steps: one step per sync chain,
// one step per async node. This is the path whose per-step checkpoint overhead
// the load test measures against the direct baseline below.
export const runWorkflowWithSteps = async (params: {
  step: StepTools;
  graph: WorkflowGraph;
  data: WorkflowTriggerData;
  deps: WorkflowDeps;
}): Promise<WorkflowRunOutcome> => {
  const { step, graph, data, deps } = params;
  const results: Record<string, NodeOutput> = {};
  for (const unit of planUnits(graph)) {
    const [asyncNode] = unit.nodes;
    if (unit.async && asyncNode !== undefined) {
      if (asyncNode.type === SUMMARIZE_NODE_TYPE && deps.llmMode === 'infer') {
        results[asyncNode.id] = await runInferSummarize(step, asyncNode, deps);
      } else {
        results[asyncNode.id] = await step.run(`node-${asyncNode.id}`, () =>
          executeNode(graph, asyncNode, results, data, deps),
        );
      }
    } else {
      const label = unit.nodes.map((node) => node.id).join('+');
      const chain = await step.run(`chain-${label}`, () =>
        executeChain(graph, unit.nodes, results, data, deps),
      );
      Object.assign(results, chain.outputs);
      if (chain.halted) {
        await step.run('record-skipped', async () => {
          await writeWorkflowResult(deps, data, 'skipped');
          return { skipped: true };
        });
        return { status: 'skipped' };
      }
    }
  }
  return { status: 'completed' };
};

// Executes the same graph inline, with no durable steps — the no-Inngest
// baseline. Same node functions, same terminal record, so the only difference
// from the stepped path is the durable-engine overhead.
export const runWorkflowDirect = async (params: {
  graph: WorkflowGraph;
  data: WorkflowTriggerData;
  deps: WorkflowDeps;
}): Promise<WorkflowRunOutcome> => {
  const { graph, data, deps } = params;
  const results: Record<string, NodeOutput> = {};
  for (const unit of planUnits(graph)) {
    const [asyncNode] = unit.nodes;
    if (unit.async && asyncNode !== undefined) {
      results[asyncNode.id] = await executeNode(graph, asyncNode, results, data, deps);
    } else {
      const chain = await executeChain(graph, unit.nodes, results, data, deps);
      Object.assign(results, chain.outputs);
      if (chain.halted) {
        await writeWorkflowResult(deps, data, 'skipped');
        return { status: 'skipped' };
      }
    }
  }
  return { status: 'completed' };
};
