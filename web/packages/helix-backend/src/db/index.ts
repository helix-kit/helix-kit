import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as authSchema from './auth-schema';
import * as blogSchema from './blog-schema';
import * as featureSchema from './feature-schema';
import * as releaseSchema from './release-schema';
import * as appSchema from './schema';

const databaseSchema = {
  ...authSchema,
  ...appSchema,
  ...releaseSchema,
  ...blogSchema,
  ...featureSchema,
};

type DatabaseSchema = typeof databaseSchema;
export type DatabaseClient = NodePgDatabase<DatabaseSchema>;

type CreateDatabasePoolOptions = Readonly<{
  connectionString: string;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  max?: number;
}>;

export const createDatabasePool = ({
  connectionString,
  connectionTimeoutMillis = 2000,
  idleTimeoutMillis = 30000,
  max = 20,
}: CreateDatabasePoolOptions): Pool =>
  new Pool({
    connectionString,
    connectionTimeoutMillis,
    idleTimeoutMillis,
    max,
  });

export const createDb = (options: {
  pool: Pool;
  logQuery?: (query: string, params: unknown[]) => void;
}) =>
  drizzle({
    client: options.pool,
    logger:
      options.logQuery === undefined
        ? undefined
        : {
            logQuery: (query, params) => {
              options.logQuery?.(query, params);
            },
          },
    schema: databaseSchema,
  });
