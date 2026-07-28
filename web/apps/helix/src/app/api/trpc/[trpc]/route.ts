import { type FetchCreateContextFnOptions, fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { applyCorsHeaders, createCorsPreflightResponse } from '@/lib/cors';
import logger from '@/lib/logger';
import { withRequestContext } from '@/lib/request-context';
import { setCookieHeader } from '@/lib/set-cookie-header';
import { appRouter, createTRPCContext } from '@/server/trpc';

const createContext = (req: Request, opts: FetchCreateContextFnOptions) => {
  return createTRPCContext({
    headers: req.headers,
    setHeader: (key, value) => setCookieHeader(key, value, opts.resHeaders),
  });
};

const handler = withRequestContext(async (req: Request) => {
  const response = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: (opts) => createContext(req, opts),
    onError: ({ path, error }) => {
      logger.error(`tRPC failed on ${path ?? '<no-path>'}: ${error.message}`);
    },
  });
  return applyCorsHeaders(req, response);
});

const optionsHandler = (req: Request) => createCorsPreflightResponse(req);

export { handler as GET, handler as POST, optionsHandler as OPTIONS };
