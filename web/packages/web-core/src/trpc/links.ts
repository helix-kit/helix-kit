import { httpBatchLink, httpSubscriptionLink, loggerLink, splitLink } from '@trpc/client';
import { SuperJSON } from 'superjson';

export type TRPCLinkOptions = Readonly<{
  /** Absolute origin used for batched HTTP calls; subscriptions always use the relative path. */
  baseUrl: string;
  /** tRPC endpoint path, relative to the app root. */
  endpoint?: string;
  /** Log every operation, not just downstream errors. */
  enableLogger?: boolean;
  /** Value sent as `x-trpc-source` so the server can attribute the call. */
  source?: string;
}>;

/** The standard Helix link chain: logger + superjson, splitting subscriptions onto SSE and everything else onto a batched POST. */
export const createTRPCLinks = ({
  baseUrl,
  endpoint = '/api/trpc',
  enableLogger = false,
  source = 'nextjs-react',
}: TRPCLinkOptions) => [
  loggerLink({
    enabled: (op) => enableLogger || (op.direction === 'down' && op.result instanceof Error),
  }),
  splitLink({
    condition: (op) => op.type === 'subscription',
    true: httpSubscriptionLink({
      transformer: SuperJSON,
      url: endpoint,
    }),
    false: httpBatchLink({
      transformer: SuperJSON,
      url: `${baseUrl}${endpoint}`,
      headers: () => {
        const headers = new Headers();
        headers.set('x-trpc-source', source);
        return headers;
      },
    }),
  }),
];
