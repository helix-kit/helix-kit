import 'server-only';

import { createDatabasePool, createDb, type DatabaseClient } from '@helix/backend/db';
import * as blogSchema from '@helix/blog/server/schema';
import * as reportSchema from '@helix/pdf-report/backend/schema';

import { env } from '@/lib/env';

const globalForDb = globalThis as unknown as { helixDb?: DatabaseClient };

export const db: DatabaseClient =
  globalForDb.helixDb ??
  createDb({
    pool: createDatabasePool({ connectionString: env.DATABASE_URL }),
    // Optional feature packages contribute their own tables; core knows nothing about them.
    extraSchema: { ...blogSchema, ...reportSchema },
  });

if (env.NODE_ENV !== 'production') {
  globalForDb.helixDb = db;
}
