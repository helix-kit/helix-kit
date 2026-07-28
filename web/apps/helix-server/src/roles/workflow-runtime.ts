import {
  createInngestClient,
  type DatabaseClient,
  type WorkflowDeps,
  type WorkflowInngestClient,
} from '@helix/backend';

import { env } from '../env';

export const buildInngestClient = (): WorkflowInngestClient =>
  createInngestClient({
    baseUrl: env.INNGEST_BASE_URL,
    eventKey: env.INNGEST_EVENT_KEY,
    signingKey: env.INNGEST_SIGNING_KEY,
    // No signing key seeded => talk to the server in dev mode (no signature check).
    isDev: env.INNGEST_SIGNING_KEY === undefined,
  });

export const buildWorkflowDeps = (db: DatabaseClient): WorkflowDeps => ({
  db,
  mode: env.HELIX_WORKFLOW_MODE,
  gateThreshold: env.HELIX_WORKFLOW_GATE_THRESHOLD,
  llmMode: env.HELIX_WORKFLOW_LLM_MODE,
  inferBaseUrl: env.HELIX_WORKFLOW_INFER_BASE_URL,
  inferModel: env.HELIX_WORKFLOW_INFER_MODEL,
  timings: {
    queryEventsMs: env.HELIX_WORKFLOW_QUERY_MS,
    summarizeMs: env.HELIX_WORKFLOW_LLM_MS,
    notifyMs: env.HELIX_WORKFLOW_NOTIFY_MS,
  },
});
