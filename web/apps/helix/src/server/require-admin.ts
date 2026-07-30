import 'server-only';

import { ADMIN_ROLES, auth } from './auth';

export type AdminUser = Readonly<{ id: string; name: string; email: string; role: string | null }>;

export type SessionUser = Readonly<{
  id: string;
  name: string;
  email: string;
  role: string | null;
  isAdmin: boolean;
}>;

// Any authenticated user (regardless of role). `isAdmin` tells callers whether to
// surface admin-only affordances; the /dashboard shell is reachable by everyone.
export const getSessionUser = async (headers: Headers): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers });
  const user = session?.user;
  if (user == null) return null;
  const role = (user as { role?: string | null }).role ?? null;
  const isAdmin = ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number]);
  return { id: user.id, name: user.name, email: user.email, role, isAdmin };
};

export const getAdminUser = async (headers: Headers): Promise<AdminUser | null> => {
  const user = await getSessionUser(headers);
  if (user?.isAdmin !== true) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
};
