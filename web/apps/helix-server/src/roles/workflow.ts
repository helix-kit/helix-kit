import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { createWorkflowFunction, type DatabaseClient } from '@helix-hq/backend';
import { logger } from '@helix-hq/logger';
import { serve } from 'inngest/node';

import { type RoleCloser } from './roles';
import { buildInngestClient, buildWorkflowDeps } from './workflow-runtime';

import { env } from '../env';
import { closeServer, listen } from '../http';

const SERVE_PATH = '/api/inngest';

// Hosts the Inngest serve endpoint the self-hosted server syncs to and invokes per durable step.
export const startWorkflow = async (deps: { db: DatabaseClient }): Promise<RoleCloser> => {
  const inngest = buildInngestClient();
  const workflowDeps = buildWorkflowDeps(deps.db);
  const workflowFn = createWorkflowFunction(inngest, workflowDeps, {
    concurrency: env.HELIX_WORKFLOW_CONCURRENCY,
  });

  const serveOrigin =
    env.HELIX_WORKFLOW_SERVE_HOST ?? `http://127.0.0.1:${env.HELIX_WORKFLOW_PORT}`;
  const handler = serve({
    client: inngest,
    functions: [workflowFn],
    serveOrigin,
    servePath: SERVE_PATH,
  });

  const server = createHttpServer((request: IncomingMessage, response: ServerResponse) => {
    const path = (request.url ?? '').split('?')[0];
    if (path === SERVE_PATH) {
      handler(request, response);
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });

  await listen(server, env.HELIX_WORKFLOW_PORT);
  logger.info(
    `Helix Server workflow serve endpoint listening on ${env.HELIX_WORKFLOW_PORT}${SERVE_PATH} ` +
      `(mode=${env.HELIX_WORKFLOW_MODE}, concurrency=${env.HELIX_WORKFLOW_CONCURRENCY}).`,
  );

  return async () => {
    await closeServer(server);
  };
};
