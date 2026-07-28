'use client';

import { useState } from 'react';

import Link from 'next/link';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@helix/design-system/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@helix/design-system/components/popover';
import { CircleAlert, CircleCheck, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import { useSession } from '@/lib/auth-client';
import { useTRPCMutation, useTRPCQuery } from '@/server/react';
import type { AppRouter } from '@/server/trpc';

import type { inferRouterOutputs } from '@trpc/server';

type Resolved = inferRouterOutputs<AppRouter>['profiles']['resolveDevice'][number];

const ADMIN_ROLES = ['admin', 'sysadmin'];

const UNRESOLVED_LABEL: Record<string, string> = {
  'no-release': 'No release on this channel / pin',
  'no-variant': 'No variant matches the selector',
};

const ResolvedRow = ({ entry }: { entry: Resolved }) => (
  <div className="border-border/60 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
    <span className="text-sm font-medium">{entry.track.releaseName}</span>
    <Badge className="font-normal" variant="secondary">
      {entry.track.typeKey}
    </Badge>
    <div className="ml-auto">
      {entry.resolution.status === 'resolved' && entry.resolution.release !== null ? (
        <span className="flex items-center gap-1.5 text-sm">
          <CircleCheck className="text-brand size-4" />
          <span className="font-medium">{entry.resolution.release.version}</span>
          {entry.resolution.variant !== null ? (
            <span className="text-muted-foreground text-xs">· {entry.resolution.variant.name}</span>
          ) : null}
        </span>
      ) : (
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <CircleAlert className="size-4" />
          {UNRESOLVED_LABEL[entry.resolution.status] ?? 'Unresolved'}
        </span>
      )}
    </div>
  </div>
);

const AssignProfilePopover = ({ deviceId, onDone }: { deviceId: string; onDone: () => void }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const search = useTRPCQuery((api) => ({
    ...api.profiles.profileSearch.queryOptions({ query, excludeDeviceId: deviceId }),
    enabled: open,
  }));
  const assign = useTRPCMutation((api) =>
    api.profiles.assignDevice.mutationOptions({
      onSuccess: () => {
        toast.success('Profile assigned');
        setOpen(false);
        setQuery('');
        onDone();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Plus />
          Assign profile
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search profiles..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{search.isLoading ? 'Searching…' : 'No profiles found.'}</CommandEmpty>
            <CommandGroup>
              {(search.data ?? []).map((profile) => (
                <CommandItem
                  key={profile.id}
                  value={profile.id}
                  onSelect={() => {
                    assign.mutate({ profileId: profile.id, deviceId });
                  }}
                >
                  {profile.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

// Admin-only section on the public device page: the device's profile assignments
// and what it currently resolves to. Renders nothing for non-admin viewers.
export const DeviceProfiles = ({ deviceId }: { deviceId: string }) => {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string | null } | undefined)?.role ?? null;
  const isAdmin = role !== null && ADMIN_ROLES.includes(role);

  const profiles = useTRPCQuery((api) => ({
    ...api.profiles.deviceProfiles.queryOptions({ deviceId }),
    enabled: isAdmin,
  }));
  const resolved = useTRPCQuery((api) => ({
    ...api.profiles.resolveDevice.queryOptions({ deviceId }),
    enabled: isAdmin,
  }));
  const unassign = useTRPCMutation((api) =>
    api.profiles.unassignDevice.mutationOptions({
      onSuccess: () => {
        toast.success('Profile unassigned');
        void profiles.refetch();
        void resolved.refetch();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!isAdmin) {
    return null;
  }

  const refetch = () => {
    void profiles.refetch();
    void resolved.refetch();
  };
  const profileRows = profiles.data ?? [];
  const resolvedRows = resolved.data ?? [];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div className="grid gap-1">
            <CardTitle className="text-base">Profiles</CardTitle>
            <CardDescription>Profiles assigned to this device.</CardDescription>
          </div>
          <AssignProfilePopover deviceId={deviceId} onDone={refetch} />
        </CardHeader>
        <CardContent className="grid gap-2">
          {profileRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No profiles assigned.</p>
          ) : (
            profileRows.map((profile) => (
              <div
                key={profile.id}
                className="border-border/60 flex items-center gap-2 rounded-md border px-3 py-2"
              >
                <Link
                  className="flex-1 truncate text-sm font-medium hover:underline"
                  href={`/admin/profiles/${profile.id}`}
                >
                  {profile.name}
                </Link>
                <Button
                  aria-label="Unassign profile"
                  className="size-8"
                  disabled={unassign.isPending}
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    unassign.mutate({ profileId: profile.id, deviceId });
                  }}
                >
                  <X />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resolved target</CardTitle>
          <CardDescription>
            What this device should run, resolved across its profiles.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {resolvedRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing resolves — assign a profile with a track.
            </p>
          ) : (
            resolvedRows.map((entry) => <ResolvedRow key={entry.track.id} entry={entry} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
};
