'use client';

import { useMemo, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import { DataTable } from '@helix/design-system/components/data-table';
import { DataTableToolbar } from '@helix/design-system/components/data-table/data-table-toolbar';
import { DeleteConfirmDialog } from '@helix/design-system/components/delete-confirm-dialog';
import { DialogFooter } from '@helix/design-system/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helix/design-system/components/dropdown-menu';
import { MutationModal } from '@helix/design-system/components/mutation-modal';
import { ResponsiveModal } from '@helix/design-system/components/responsive-modal';
import { useDataTable } from '@helix/design-system/hooks/use-data-table';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Copy, KeyRound, MoreHorizontal, Plus, Power, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { useTRPCMutation } from '@/server/react';
import type { AppRouter } from '@/server/trpc';

import type { inferRouterOutputs } from '@trpc/server';

type DeviceRow = inferRouterOutputs<AppRouter>['devices']['list']['rows'][number];
type RevealedToken = { name: string; token: string };

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const ID_PREVIEW = 16;

const copy = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success('Copied');
  } catch {
    toast.error('Copy failed');
  }
};

// One-time reveal of a freshly created / rotated access token. Opened
// programmatically (no trigger of its own), so it goes through ResponsiveModal
// directly rather than MutationModal/DeleteConfirmDialog.
const TokenDialog = ({ token, onClose }: { token: RevealedToken | null; onClose: () => void }) => (
  <ResponsiveModal
    description="Copy it now — this token is shown only once and cannot be retrieved later."
    open={token !== null}
    title={token === null ? undefined : `Access token for ${token.name}`}
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
  >
    <div className="flex min-w-0 items-center gap-2">
      <code className="bg-muted/50 min-w-0 flex-1 truncate rounded-md border px-3 py-2 font-mono text-xs">
        {token?.token}
      </code>
      <Button
        size="icon"
        variant="outline"
        onClick={() => {
          if (token !== null) {
            void copy(token.token);
          }
        }}
      >
        <Copy />
      </Button>
    </div>
    <DialogFooter>
      <Button onClick={onClose}>Done</Button>
    </DialogFooter>
  </ResponsiveModal>
);

const DEVICE_NAME_MAX = 200;
const DEVICE_DESCRIPTION_MAX = 500;

const registerDeviceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(DEVICE_NAME_MAX),
  description: z
    .string()
    .max(DEVICE_DESCRIPTION_MAX)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed === undefined || trimmed === '' ? undefined : trimmed;
    }),
});

const RegisterDeviceDialog = ({ onToken }: { onToken: (token: RevealedToken) => void }) => {
  const router = useRouter();
  const create = useTRPCMutation((api) => api.devices.create.mutationOptions());

  return (
    <MutationModal
      customDescription="Creates a device and issues a one-time access token it uses to authenticate."
      defaultValues={{ name: '', description: '' }}
      fields={[
        { name: 'name', label: 'Name', type: 'input', placeholder: 'sensor-hub-01' },
        { name: 'description', label: 'Description', type: 'input', placeholder: 'Optional' },
      ]}
      mutation={create}
      refresh={(result) => {
        onToken({ name: result.name, token: result.accessToken });
        router.refresh();
      }}
      schema={registerDeviceSchema}
      submitButtonText="Register"
      successToast={() => 'Device registered'}
      titleText="Register device"
      trigger={
        <Button size="sm">
          <Plus />
          Register device
        </Button>
      }
    />
  );
};

const RowActions = ({
  device,
  onToken,
}: {
  device: DeviceRow;
  onToken: (token: RevealedToken) => void;
}) => {
  const router = useRouter();

  const setActive = useTRPCMutation((api) =>
    api.devices.setActive.mutationOptions({
      onSuccess: () => {
        toast.success(device.isActive ? 'Device deactivated' : 'Device activated');
        router.refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const rotate = useTRPCMutation((api) =>
    api.devices.rotateToken.mutationOptions({
      onSuccess: (result) => {
        onToken({ name: device.name, token: result.accessToken });
        router.refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const remove = useTRPCMutation((api) =>
    api.devices.delete.mutationOptions({
      onSuccess: () => {
        toast.success('Device deleted');
        router.refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const pending = setActive.isPending || rotate.isPending || remove.isPending;

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Device actions"
            className="size-8"
            disabled={pending}
            size="icon"
            variant="ghost"
          >
            <MoreHorizontal />
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
          <DropdownMenuItem
            onClick={() => {
              rotate.mutate({ id: device.id });
            }}
          >
            <KeyRound />
            Rotate token
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
    </div>
  );
};

export const DevicesTable = ({ rows, pageCount }: { rows: DeviceRow[]; pageCount: number }) => {
  const [revealed, setRevealed] = useState<RevealedToken | null>(null);

  const columns = useMemo<ColumnDef<DeviceRow>[]>(
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
            Device
            <ArrowUpDown />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="grid">
            <Link
              className="truncate font-medium hover:underline"
              href={`/device/${row.original.id}`}
            >
              {row.original.name}
            </Link>
            {row.original.description !== null ? (
              <span className="text-muted-foreground truncate text-xs">
                {row.original.description}
              </span>
            ) : null}
          </div>
        ),
        enableColumnFilter: true,
        meta: { label: 'Device', variant: 'text', placeholder: 'Filter by name...' },
      },
      {
        id: 'deviceId',
        accessorKey: 'id',
        header: 'Device ID',
        cell: ({ row }) => (
          <button
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 font-mono text-xs"
            type="button"
            onClick={() => {
              void copy(row.original.id);
            }}
          >
            {row.original.id.slice(0, ID_PREVIEW)}…
            <Copy className="size-3" />
          </button>
        ),
        enableSorting: false,
      },
      {
        id: 'status',
        accessorKey: 'isActive',
        header: 'Status',
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? 'default' : 'outline'}>
            {row.original.isActive ? 'Active' : 'Inactive'}
          </Badge>
        ),
        enableSorting: false,
        enableColumnFilter: true,
        meta: {
          label: 'Status',
          variant: 'multiSelect',
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' },
          ],
        },
      },
      {
        id: 'eventCount',
        accessorKey: 'eventCount',
        header: 'Events',
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">{row.original.eventCount}</span>
        ),
        enableSorting: false,
      },
      {
        id: 'lastSeenAt',
        accessorKey: 'lastSeenAt',
        header: 'Last seen',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {row.original.lastSeenAt === null
              ? 'Never'
              : dateFormatter.format(row.original.lastSeenAt)}
          </span>
        ),
        enableSorting: false,
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
            Created
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
        cell: ({ row }) => <RowActions device={row.original} onToken={setRevealed} />,
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [],
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
    <>
      <DataTable className="min-h-0 flex-1" getItemValue={(row) => row.id} table={table}>
        <DataTableToolbar table={table}>
          <RegisterDeviceDialog onToken={setRevealed} />
        </DataTableToolbar>
      </DataTable>
      <TokenDialog
        token={revealed}
        onClose={() => {
          setRevealed(null);
        }}
      />
    </>
  );
};
