import { Inngest } from 'inngest';

import { type WorkflowTriggerData } from './types';

// App / function / event identifiers. The self-hosted Inngest server keys runs by
// these, and the dispatch role sends WORKFLOW_EVENT_NAME to trigger the function.
export const WORKFLOW_APP_ID = 'helix-workflow';
export const WORKFLOW_FUNCTION_ID = 'device-event-workflow';
export const WORKFLOW_EVENT_NAME = 'helix/device-event.workflow';

export type WorkflowInngestClient = Inngest.Any;

export type CreateInngestClientOptions = Readonly<{
  baseUrl?: string;
  eventKey?: string;
  signingKey?: string;
  isDev?: boolean;
}>;

// The SDK also reads INNGEST_BASE_URL / INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY
// from the environment; passing them explicitly keeps wiring visible and lets a
// caller point at a different server per role.
export const createInngestClient = (options: CreateInngestClientOptions): WorkflowInngestClient =>
  new Inngest({
    id: WORKFLOW_APP_ID,
    baseUrl: options.baseUrl,
    eventKey: options.eventKey,
    signingKey: options.signingKey,
    isDev: options.isDev,
  });

// Lifts the fields the workflow needs off an ingested device event. `payload` is
// the envelope's inner payload (the load generator emits publishedAtNs/seq/runId).
export const buildWorkflowTrigger = (params: {
  deviceId: string;
  messageId: string;
  payload: unknown;
}): WorkflowTriggerData => {
  const payload = (
    typeof params.payload === 'object' && params.payload !== null ? params.payload : {}
  ) as Record<string, unknown>;
  return {
    deviceId: params.deviceId,
    messageId: params.messageId,
    runId: typeof payload.runId === 'string' ? payload.runId : null,
    emittedAtNs: payload.publishedAtNs === undefined ? null : String(payload.publishedAtNs),
    metric: typeof payload.seq === 'number' ? payload.seq : 0,
  };
};
