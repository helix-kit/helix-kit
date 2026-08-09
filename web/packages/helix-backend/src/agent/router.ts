import { eq } from 'drizzle-orm';

import type { DatabaseClient } from '../db';

import { user as userTable } from '../db/auth-schema';

export type AgentSessionUser = Readonly<{
  id: string;
  name: string;
  role: string | null;
}>;

export type AgentContext = Readonly<{
  db: DatabaseClient;
  user: AgentSessionUser | null;
  adminRoles: readonly string[];
}>;

/**
 * Look up the minimal session-user shape for a user id — used by the MCP server to
 * build a request context after authenticating via OAuth token or API key.
 */
export const findAgentUser = async (
  db: DatabaseClient,
  userId: string,
): Promise<AgentSessionUser | null> => {
  const [row] = await db
    .select({ id: userTable.id, name: userTable.name, role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row === undefined ? null : { id: row.id, name: row.name, role: row.role ?? null };
};
