import 'server-only';

import { createDatabasePool, createDb, type DatabaseClient } from '@helix/backend/db';

import { env } from '@/lib/env';

const globalForDb = globalThis as unknown as { helixDb?: DatabaseClient };

export const db: DatabaseClient =
  globalForDb.helixDb ??
  createDb({ pool: createDatabasePool({ connectionString: env.DATABASE_URL }) });

if (env.NODE_ENV !== 'production') {
  globalForDb.helixDb = db;
}
