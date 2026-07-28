import { createLoader, type SearchParams } from 'nuqs/server';

import { fetchQuery } from '@/server/server';

import { usersSearchParsers } from './search-params';
import { UsersTable } from './users-table';

const loadSearch = createLoader(usersSearchParsers);

const ROLE_LABELS: Record<string, string> = { sysadmin: 'Sysadmin', admin: 'Admin', user: 'User' };
const roleLabel = (role: string): string => ROLE_LABELS[role] ?? role;

const UsersPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const params = await loadSearch(searchParams);
  const [{ rows, pageCount }, filterOptions] = await Promise.all([
    fetchQuery((trpc) => trpc.users.list.queryOptions(params)),
    fetchQuery((trpc) => trpc.users.filterOptions.queryOptions()),
  ]);

  const roleOptions = filterOptions.roles.map((role) => ({ label: roleLabel(role), value: role }));

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 p-4 sm:p-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground text-sm">
          Manage accounts — roles, bans, and deletion.
        </p>
      </div>

      <UsersTable pageCount={pageCount} roleOptions={roleOptions} rows={rows} />
    </div>
  );
};

export default UsersPage;
