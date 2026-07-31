import { Inngest } from 'inngest';

import { type WorkflowTriggerData } from './types';

// The self-hosted Inngest server keys runs by these identifiers.
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

// Passed explicitly (rather than relying on the SDK's env fallback) so a caller can point at a different server per role.
export const createInngestClient = (options: CreateInngestClientOptions): WorkflowInngestClient =>
  new Inngest({
    id: WORKFLOW_APP_ID,
    baseUrl: options.baseUrl,
    eventKey: options.eventKey,
    signingKey: options.signingKey,
    isDev: options.isDev,
  });

// Lifts the fields the workflow needs off an ingested device event's payload.
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
