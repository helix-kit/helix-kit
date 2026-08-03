import { createRouterFactory } from '@helix/backend/trpc';

import type { CatalogDatabase } from './db';

/**
 * Who is writing. Authentication is not wired yet — the app is open for local development —
 * but every mutation already records an actor, so switching on OIDC later means populating
 * this from a session instead of reshaping the routers.
 */
export type CatalogActor = Readonly<{
  kind: 'human' | 'agent' | 'import' | 'system';
  id: string | null;
  displayName: string;
}>;

export const ANONYMOUS_ACTOR: CatalogActor = {
  kind: 'human',
  id: null,
  displayName: 'anonymous',
};

export type CatalogContext = Readonly<{
  db: CatalogDatabase;
  actor: CatalogActor;
}>;

/** Every catalog router is built through this, so they all share one context contract. */
export const catalogRouter = createRouterFactory<CatalogContext>();
