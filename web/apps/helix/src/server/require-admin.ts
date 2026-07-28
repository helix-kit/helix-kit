import 'server-only';

import { ADMIN_ROLES, auth } from './auth';

export type AdminUser = Readonly<{ id: string; name: string; email: string; role: string | null }>;

export const getAdminUser = async (headers: Headers): Promise<AdminUser | null> => {
  const session = await auth.api.getSession({ headers });
  const user = session?.user;
  if (user == null) return null;
  const role = (user as { role?: string | null }).role ?? null;
  if (!ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) return null;
  return { id: user.id, name: user.name, email: user.email, role };
};
