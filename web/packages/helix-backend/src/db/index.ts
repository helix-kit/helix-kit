import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as agentSchema from './agent-schema';
import * as authSchema from './auth-schema';
import * as featureSchema from './feature-schema';
import * as releaseSchema from './release-schema';
import * as appSchema from './schema';

const databaseSchema = {
  ...authSchema,
  ...appSchema,
  ...releaseSchema,
  ...featureSchema,
  ...agentSchema,
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
  /**
   * Tables contributed by optional feature packages (e.g. `@helix/blog`). Core stays
   * unaware of them; they are registered so drizzle's relational API and migrations see
   * them, while `DatabaseClient` keeps describing the core schema.
   */
  extraSchema?: Record<string, unknown>;
}): DatabaseClient =>
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
    schema: { ...databaseSchema, ...options.extraSchema },
  }) as DatabaseClient;
