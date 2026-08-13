import 'server-only';

import { createDatabasePool, createDb, type DatabaseClient } from '@helix-hq/backend/db';
import * as blogSchema from '@helix-hq/blog/server/schema';

import { env } from '@/lib/env';

import * as reportSchema from './report-templates/schema';

const globalForDb = globalThis as unknown as { helixDb?: DatabaseClient };

export const db: DatabaseClient =
  globalForDb.helixDb ??
  createDb({
    pool: createDatabasePool({ connectionString: env.DATABASE_URL }),
    // Optional feature packages and app-local features contribute their own
    // tables; core knows nothing about them.
    extraSchema: { ...blogSchema, ...reportSchema },
  });

if (env.NODE_ENV !== 'production') {
  globalForDb.helixDb = db;
}
