import { collectProcedureDescriptors, invokeProcedure } from '@helix/backend/agent';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';

import { auth } from '@/server/auth';
import { appRouter, createTRPCContextForUser } from '@/server/trpc';

// Static tool descriptors — the same exposed procedure surface the site agent uses.
// A caller is built per tool call from the request's authenticated user.
const descriptors = collectProcedureDescriptors(appRouter);

const baseHandler = createMcpHandler(
  (server) => {
    for (const descriptor of descriptors) {
      server.registerTool(
        descriptor.name,
        { description: descriptor.description, inputSchema: descriptor.inputSchema },
        async (args, ctx) => {
          const userId = ctx.http?.authInfo?.extra?.['userId'];
          if (typeof userId !== 'string') {
            return { content: [{ type: 'text' as const, text: 'Unauthorized.' }], isError: true };
          }
          const requestCtx = await createTRPCContextForUser(userId);
          const caller = appRouter.createCaller(requestCtx);
          try {
            const result = await invokeProcedure(caller, descriptor.path, args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Tool error.';
            return { content: [{ type: 'text' as const, text: message }], isError: true };
          }
        },
      );
    }
  },
  { serverInfo: { name: 'helix', version: '0.1.0' } },
);

// Accept either an OAuth 2.1 bearer token (issued by the Better Auth mcp plugin) or
// a personal API key (x-api-key). Both resolve to the owning user id, which the tool
// handlers turn into a scoped tRPC caller.
const verifyToken = async (req: Request, bearerToken?: string) => {
  const apiKeyHeader = req.headers.get('x-api-key');
  if (apiKeyHeader != null && apiKeyHeader !== '') {
    const result = await auth.api.verifyApiKey({ body: { key: apiKeyHeader } });
    const ownerId = result.key?.referenceId;
    if (result.valid && ownerId != null) {
      return { token: apiKeyHeader, clientId: 'api-key', scopes: [], extra: { userId: ownerId } };
    }
    return undefined;
  }

  if (bearerToken != null && bearerToken !== '') {
    const session = await auth.api.getMcpSession({ headers: req.headers });
    if (session != null) {
      return {
        token: bearerToken,
        clientId: session.clientId,
        scopes: typeof session.scopes === 'string' ? session.scopes.split(' ') : [],
        extra: { userId: session.userId },
      };
    }
  }

  return undefined;
};

const handler = withMcpAuth(baseHandler, verifyToken, { required: true });

export { handler as GET, handler as POST };
