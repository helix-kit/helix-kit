'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@helix/design-system/components/button';
import { DeleteConfirmDialog } from '@helix/design-system/components/delete-confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helix/design-system/components/dropdown-menu';
import { MoreHorizontal, Power, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { useSession } from '@/lib/auth-client';
import { useTRPCMutation } from '@/server/react';

// Client-side gate to hide destructive controls; mutations are admin-gated server-side.
const ADMIN_ROLES = ['admin', 'sysadmin'];

export const DeviceActions = ({
  device,
}: {
  device: { id: string; name: string; isActive: boolean };
}) => {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string | null } | undefined)?.role ?? null;
  const isAdmin = role !== null && ADMIN_ROLES.includes(role);

  const setActive = useTRPCMutation((api) =>
    api.devices.setActive.mutationOptions({
      onSuccess: () => {
        toast.success(device.isActive ? 'Device deactivated' : 'Device activated');
        router.refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const remove = useTRPCMutation((api) =>
    api.devices.delete.mutationOptions({
      onSuccess: () => {
        toast.success('Device deleted');
        router.push('/admin/devices');
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!isAdmin) {
    return null;
  }

  const pending = setActive.isPending || remove.isPending;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Device actions" disabled={pending} size="sm" variant="outline">
          <MoreHorizontal />
          Actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onClick={() => {
            setActive.mutate({ id: device.id, isActive: !device.isActive });
          }}
        >
          <Power />
          {device.isActive ? 'Deactivate' : 'Activate'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DeleteConfirmDialog
          description="This removes the device and its event history. The device can no longer authenticate. This cannot be undone."
          isPending={remove.isPending}
          title={`Delete ${device.name}?`}
          trigger={
            <DropdownMenuItem
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
            remove.mutate({ id: device.id });
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
