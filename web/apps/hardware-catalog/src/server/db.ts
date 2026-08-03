import 'server-only';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '@/lib/env';

import * as schema from './schema';

/** The catalog's own database. It shares no connection, pool, or table with core Helix. */
export type CatalogDatabase = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { catalogDb?: CatalogDatabase };

const createCatalogDb = (): CatalogDatabase =>
  drizzle({
    client: new Pool({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      max: 10,
    }),
    schema,
  });

export const db: CatalogDatabase = globalForDb.catalogDb ?? createCatalogDb();

if (env.NODE_ENV !== 'production') {
  globalForDb.catalogDb = db;
}
