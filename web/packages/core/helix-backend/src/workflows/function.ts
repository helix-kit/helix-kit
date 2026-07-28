import { type InngestFunction } from 'inngest';

import { WORKFLOW_EVENT_NAME, WORKFLOW_FUNCTION_ID, type WorkflowInngestClient } from './client';
import { runWorkflowWithSteps, type StepTools } from './executor';
import { DEVICE_EVENT_WORKFLOW } from './graph';
import { type WorkflowDeps, type WorkflowTriggerData } from './types';

// The Inngest handler context, narrowed to what the executor uses. `Inngest.Any`
// erases the per-event typing, so we annotate the pieces we read ourselves.
type WorkflowHandlerContext = Readonly<{
  event: Readonly<{ data: WorkflowTriggerData }>;
  step: StepTools;
}>;

export type WorkflowFunctionOptions = Readonly<{
  // Max concurrently-executing runs. With a ~5s summarize step, this is the knob
  // that sets the throughput ceiling (≈ concurrency / summarizeSeconds runs/s).
  concurrency: number;
}>;

// No retries: the load test measures steady-state work, not retry amplification.
const WORKFLOW_RETRIES = 0;

// The single Inngest function that runs the hardcoded device-event graph. One
// function walks the whole graph via durable steps — the same "one generic
// function interprets a JSON graph" shape as the full engine, minus the
// user-defined-graph machinery.
export const createWorkflowFunction = (
  inngest: WorkflowInngestClient,
  deps: WorkflowDeps,
  options: WorkflowFunctionOptions,
): InngestFunction.Any => {
  const workflowFn = inngest.createFunction(
    {
      id: WORKFLOW_FUNCTION_ID,
      retries: WORKFLOW_RETRIES,
      concurrency: { limit: options.concurrency },
      triggers: [{ event: WORKFLOW_EVENT_NAME }],
    },
    async ({ event, step }: WorkflowHandlerContext) =>
      runWorkflowWithSteps({
        step,
        graph: DEVICE_EVENT_WORKFLOW,
        data: event.data,
        deps,
      }),
  );
  return workflowFn as InngestFunction.Any;
};
