'use client';

import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import { useTRPCMutation, useTRPCQuery } from '@/server/react';
import type { AppRouter } from '@/server/trpc';

import type { inferRouterOutputs } from '@trpc/server';

type ProfileDetail = inferRouterOutputs<AppRouter>['profiles']['get'];
type AssignedDevice = NonNullable<ProfileDetail>['devices'][number];

const AddDevicePopover = ({ profileId }: { profileId: string }) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const search = useTRPCQuery((api) => ({
    ...api.profiles.deviceSearch.queryOptions({ query, excludeProfileId: profileId }),
    enabled: open,
  }));
  const assign = useTRPCMutation((api) =>
    api.profiles.assignDevice.mutationOptions({
      onSuccess: () => {
        toast.success('Device assigned');
        setOpen(false);
        setQuery('');
        router.refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Plus />
          Assign device
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search devices..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{search.isLoading ? 'Searching…' : 'No devices found.'}</CommandEmpty>
            <CommandGroup>
              {(search.data ?? []).map((device) => (
                <CommandItem
                  key={device.id}
                  value={device.id}
                  onSelect={() => {
                    assign.mutate({ profileId, deviceId: device.id });
                  }}
                >
                  <span className="flex-1 truncate">{device.name}</span>
                  {!device.isActive ? (
                    <Badge className="font-normal" variant="outline">
                      inactive
                    </Badge>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const DeviceRow = ({ device, profileId }: { device: AssignedDevice; profileId: string }) => {
  const router = useRouter();
  const unassign = useTRPCMutation((api) =>
    api.profiles.unassignDevice.mutationOptions({
      onSuccess: () => {
        toast.success('Device unassigned');
        router.refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  return (
    <div className="border-border/60 flex items-center gap-2 rounded-md border px-3 py-2">
      <Link
        className="flex-1 truncate text-sm font-medium hover:underline"
        href={`/device/${device.deviceId}`}
      >
        {device.name}
      </Link>
      <Badge variant={device.isActive ? 'default' : 'outline'}>
        {device.isActive ? 'Active' : 'Inactive'}
      </Badge>
      <Button
        aria-label="Unassign device"
        className="size-8"
        disabled={unassign.isPending}
        size="icon"
        variant="ghost"
        onClick={() => {
          unassign.mutate({ profileId, deviceId: device.deviceId });
        }}
      >
        <X />
      </Button>
    </div>
  );
};

export const DevicesPanel = ({
  profileId,
  devices,
}: {
  profileId: string;
  devices: AssignedDevice[];
}) => (
  <Card>
    <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
      <div className="grid gap-1">
        <CardTitle className="text-base">Assigned devices</CardTitle>
        <CardDescription>Devices that run what this profile resolves to.</CardDescription>
      </div>
      <AddDevicePopover profileId={profileId} />
    </CardHeader>
    <CardContent className="grid gap-2">
      {devices.length === 0 ? (
        <p className="text-muted-foreground text-sm">No devices assigned yet.</p>
      ) : (
        devices.map((device) => (
          <DeviceRow key={device.deviceId} device={device} profileId={profileId} />
        ))
      )}
    </CardContent>
  </Card>
);
