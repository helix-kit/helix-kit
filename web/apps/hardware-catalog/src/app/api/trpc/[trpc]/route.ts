import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { appRouter, createTRPCContext } from '@/server/trpc';

const handler = (req: Request): Promise<Response> =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: createTRPCContext,
    onError: ({ path, error }) => {
      // eslint-disable-next-line no-console -- the catalog has no logger yet; local dev only
      console.error(`tRPC failed on ${path ?? '<no-path>'}: ${error.message}`);
    },
  });

export { handler as GET, handler as POST };
