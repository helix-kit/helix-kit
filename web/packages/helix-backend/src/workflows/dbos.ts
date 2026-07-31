import { DBOS } from '@dbos-inc/dbos-sdk';

import { runWorkflowWithSteps, type StepTools } from './executor';
import { DEVICE_EVENT_WORKFLOW } from './graph';
import { type WorkflowDeps, type WorkflowRunOutcome, type WorkflowTriggerData } from './types';

// Unlike Inngest, DBOS runs in-process: a step checkpoints to Postgres directly, no HTTP round-trip.
const dbosStep: StepTools = {
  run: <T>(id: string, handler: () => Promise<T> | T): Promise<T> =>
    DBOS.runStep<T>(async () => handler(), { name: id }),
};

let registeredWorkflow: ((data: WorkflowTriggerData) => Promise<WorkflowRunOutcome>) | null = null;

// Call once at startup, before running any workflow.
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
    // Dedicated schema in the app's Postgres, not a separate database.
    systemDatabaseSchemaName: params.systemDatabaseSchema ?? 'dbos',
    // A small pool serializes runs even when CPU/Postgres are idle.
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
