import { defaultShouldDehydrateQuery, QueryClient } from '@tanstack/react-query';
import { SuperJSON } from 'superjson';

const DEFAULT_STALE_TIME_MS = 60_000;

/** A QueryClient wired for superjson (de)serialization and streamed RSC hydration of pending queries. */
export const createQueryClient = (options?: { staleTimeMs?: number }): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: options?.staleTimeMs ?? DEFAULT_STALE_TIME_MS,
      },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query): boolean =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
