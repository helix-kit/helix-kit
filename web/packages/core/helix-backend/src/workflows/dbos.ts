import { DBOS } from '@dbos-inc/dbos-sdk';

import { runWorkflowWithSteps, type StepTools } from './executor';
import { DEVICE_EVENT_WORKFLOW } from './graph';
import { type WorkflowDeps, type WorkflowRunOutcome, type WorkflowTriggerData } from './types';

// StepTools backed by DBOS.runStep — the SAME graph executor drives both Inngest
// and DBOS; only the durable-step backend differs. The crucial difference from
// Inngest: DBOS runs in *this* Node process, so a step is an in-process call that
// checkpoints to Postgres — no HTTP round-trip to a separate engine per step.
const dbosStep: StepTools = {
  run: <T>(id: string, handler: () => Promise<T> | T): Promise<T> =>
    DBOS.runStep<T>(async () => handler(), { name: id }),
};

let registeredWorkflow: ((data: WorkflowTriggerData) => Promise<WorkflowRunOutcome>) | null = null;

// Configure + register the workflow, then launch DBOS (which connects to the
// system database and runs its own schema migrations). Call once at startup
// before running any workflow.
const DEFAULT_SYSTEM_DB_POOL_SIZE = 100;

export const initDbosWorkflow = async (params: {
  systemDatabaseUrl: string;
  systemDatabaseSchema?: string;
  systemDatabasePoolSize?: number;
  deps: WorkflowDeps;
}): Promise<void> => {
  DBOS.setConfig({
    name: 'helix-workflow',
    systemDatabaseUrl: params.systemDatabaseUrl,
    // DBOS keeps its checkpoint tables in this schema of the given database, so it
    // can share the app's Postgres (a dedicated schema, not a separate database).
    systemDatabaseSchemaName: params.systemDatabaseSchema ?? 'dbos',
    // The connection pool bounds how many checkpoint writes run concurrently — a
    // small pool serializes runs even when CPU/Postgres are idle.
    systemDatabasePoolSize: params.systemDatabasePoolSize ?? DEFAULT_SYSTEM_DB_POOL_SIZE,
  });
  registeredWorkflow = DBOS.registerWorkflow(
    async (data: WorkflowTriggerData): Promise<WorkflowRunOutcome> =>
      runWorkflowWithSteps({
        step: dbosStep,
        graph: DEVICE_EVENT_WORKFLOW,
        data,
        deps: params.deps,
      }),
    { name: 'device-event-workflow' },
  );
  await DBOS.launch();
};

export const runWorkflowDbos = async (data: WorkflowTriggerData): Promise<WorkflowRunOutcome> => {
  if (registeredWorkflow === null) {
    throw new Error('DBOS workflow not initialized; call initDbosWorkflow first.');
  }
  return registeredWorkflow(data);
};

export const shutdownDbosWorkflow = async (): Promise<void> => {
  await DBOS.shutdown();
};
