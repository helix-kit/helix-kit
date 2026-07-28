'use client';

import { useMemo } from 'react';

import { useRouter } from 'next/navigation';

import { Avatar, AvatarFallback, AvatarImage } from '@helix/design-system/components/avatar';
import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import { DataTable } from '@helix/design-system/components/data-table';
import { DataTableToolbar } from '@helix/design-system/components/data-table/data-table-toolbar';
import { DeleteConfirmDialog } from '@helix/design-system/components/delete-confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@helix/design-system/components/dropdown-menu';
import { useDataTable } from '@helix/design-system/hooks/use-data-table';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Ban, MoreHorizontal, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { toast } from 'sonner';

import { useSession } from '@/lib/auth-client';
import { useTRPCMutation } from '@/server/react';
import type { AppRouter } from '@/server/trpc';

import type { inferRouterOutputs } from '@trpc/server';

type UserRow = inferRouterOutputs<AppRouter>['users']['list']['rows'][number];

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

const ASSIGNABLE_ROLES = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
  { value: 'sysadmin', label: 'Sysadmin' },
] as const;

const effectiveRole = (role: string | null): string => role ?? 'user';

const ROLE_LABELS: Record<string, string> = { sysadmin: 'Sysadmin', admin: 'Admin', user: 'User' };
const roleLabel = (role: string | null): string => ROLE_LABELS[effectiveRole(role)] ?? 'User';

const ROLE_BADGE: Record<string, 'default' | 'secondary' | 'outline'> = {
  sysadmin: 'default',
  admin: 'secondary',
};
const roleBadgeVariant = (role: string | null): 'default' | 'secondary' | 'outline' =>
  ROLE_BADGE[role ?? ''] ?? 'outline';

const displayName = (name: string, email: string): string => (name.trim() === '' ? email : name);

const initialsOf = (value: string): string => {
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return initials === '' ? '?' : initials;
};

const RowActions = ({ user }: { user: UserRow }) => {
  const router = useRouter();
  const { data: session } = useSession();
  const isSelf = session?.user.id === user.id;

  const onError = (error: { message: string }) => {
    toast.error(error.message);
  };
  const refresh = (message: string) => () => {
    toast.success(message);
    router.refresh();
  };

  const roleMutation = useTRPCMutation((api) =>
    api.users.setRole.mutationOptions({ onSuccess: refresh('Role updated'), onError }),
  );
  const banMutation = useTRPCMutation((api) =>
    api.users.setBan.mutationOptions({
      onSuccess: refresh(user.banned === true ? 'User unbanned' : 'User banned'),
      onError,
    }),
  );
  const removeMutation = useTRPCMutation((api) =>
    api.users.remove.mutationOptions({ onSuccess: refresh('User deleted'), onError }),
  );

  const pending = roleMutation.isPending || banMutation.isPending || removeMutation.isPending;

  const setRole = (role: string) => {
    if (role === effectiveRole(user.role)) {
      return;
    }
    roleMutation.mutate({ userId: user.id, role: role as 'user' | 'admin' | 'sysadmin' });
  };

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="User actions"
            className="size-8"
            disabled={pending}
            size="icon"
            variant="ghost"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <UserCog />
              Set role
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={effectiveRole(user.role)} onValueChange={setRole}>
                {ASSIGNABLE_ROLES.map((role) => (
                  <DropdownMenuRadioItem key={role.value} value={role.value}>
                    {role.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {user.banned === true ? (
            <DropdownMenuItem
              onClick={() => {
                banMutation.mutate({ userId: user.id, banned: false });
              }}
            >
              <ShieldCheck />
              Unban
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={isSelf}
              onClick={() => {
                banMutation.mutate({ userId: user.id, banned: true });
              }}
            >
              <Ban />
              Ban
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DeleteConfirmDialog
            description="This permanently removes the account, its sessions, and credentials. This cannot be undone."
            isPending={removeMutation.isPending}
            title={`Delete ${displayName(user.name, user.email)}?`}
            trigger={
              <DropdownMenuItem
                disabled={isSelf}
                variant="destructive"
                onSelect={(event) => {
                  event.preventDefault();
                }}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            }
            onConfirm={() => {
              removeMutation.mutate({ userId: user.id });
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export const UsersTable = ({
  rows,
  pageCount,
  roleOptions,
}: {
  rows: UserRow[];
  pageCount: number;
  roleOptions: { label: string; value: string }[];
}) => {
  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => (
          <Button
            className="-ml-2.5"
            size="sm"
            variant="ghost"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === 'asc');
            }}
          >
            User
            <ArrowUpDown />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              {row.original.image !== null ? (
                <AvatarImage alt={row.original.name} src={row.original.image} />
              ) : null}
              <AvatarFallback className="text-xs">
                {initialsOf(displayName(row.original.name, row.original.email))}
              </AvatarFallback>
            </Avatar>
            <div className="grid">
              <span className="truncate font-medium">
                {row.original.name.trim() === '' ? 'Unnamed user' : row.original.name}
              </span>
              <span className="text-muted-foreground truncate text-xs">{row.original.email}</span>
            </div>
          </div>
        ),
        enableColumnFilter: true,
        meta: { label: 'User', variant: 'text', placeholder: 'Search name or email...' },
      },
      {
        id: 'role',
        accessorKey: 'role',
        header: 'Role',
        cell: ({ row }) => (
          <Badge variant={roleBadgeVariant(row.original.role)}>
            {roleLabel(row.original.role)}
          </Badge>
        ),
        enableSorting: false,
        enableColumnFilter: true,
        meta: { label: 'Role', variant: 'multiSelect', options: roleOptions },
      },
      {
        id: 'verified',
        accessorKey: 'emailVerified',
        header: 'Email',
        cell: ({ row }) => (
          <Badge variant={row.original.emailVerified ? 'secondary' : 'outline'}>
            {row.original.emailVerified ? 'Verified' : 'Pending'}
          </Badge>
        ),
        enableSorting: false,
      },
      {
        id: 'status',
        accessorKey: 'banned',
        header: 'Status',
        cell: ({ row }) =>
          row.original.banned === true ? (
            <Badge title={row.original.banReason ?? undefined} variant="destructive">
              Banned
            </Badge>
          ) : (
            <Badge variant="outline">Active</Badge>
          ),
        enableSorting: false,
        enableColumnFilter: true,
        meta: {
          label: 'Status',
          variant: 'multiSelect',
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Banned', value: 'banned' },
          ],
        },
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <Button
            className="-ml-2.5"
            size="sm"
            variant="ghost"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === 'asc');
            }}
          >
            Joined
            <ArrowUpDown />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {dateFormatter.format(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => <RowActions user={row.original} />,
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [roleOptions],
  );

  const { table } = useDataTable({
    data: rows,
    columns,
    pageCount,
    shallow: false,
    getRowId: (row) => row.id,
    initialState: { sorting: [{ id: 'createdAt', desc: true }] },
  });

  return (
    <DataTable className="min-h-0 flex-1" getItemValue={(row) => row.id} table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
};
