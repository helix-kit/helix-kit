'use client';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';
import { Switch } from '@helix/design-system/components/switch';
import { toast } from 'sonner';

import { useSession } from '@/lib/auth-client';
import { useTRPCMutation, useTRPCQuery } from '@/server/react';

const ADMIN_ROLES = ['admin', 'sysadmin'];

const SOURCE_LABEL: Record<string, string> = {
  override: 'Override',
  profile: 'Profile',
  default: 'Default',
};

// Admin-only section on the public device page: the device's effective cloud
// features and the per-device override exceptions. Toggling a feature sets an
// override (force on/off); clearing it falls back to the profile/default.
// Renders nothing for non-admin viewers.
export const DeviceFeatureOverrides = ({ deviceId }: { deviceId: string }) => {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string | null } | undefined)?.role ?? null;
  const isAdmin = role !== null && ADMIN_ROLES.includes(role);

  const resolved = useTRPCQuery((api) => ({
    ...api.features.resolveDevice.queryOptions({ deviceId }),
    enabled: isAdmin,
  }));
  const setOverride = useTRPCMutation((api) =>
    api.features.setDeviceOverride.mutationOptions({
      onSuccess: () => void resolved.refetch(),
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!isAdmin) {
    return null;
  }

  const rows = resolved.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Features</CardTitle>
        <CardDescription>
          Effective cloud features for this device. Toggling sets a device-specific override; clear
          it to fall back to the profile.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No features registered.</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.key}
              className="border-border/60 flex items-center gap-2 rounded-md border px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{row.key}</span>
              <Badge
                className="font-normal"
                variant={row.source === 'override' ? 'default' : 'secondary'}
              >
                {SOURCE_LABEL[row.source] ?? row.source}
              </Badge>
              {row.source === 'override' ? (
                <Button
                  className="h-8"
                  disabled={setOverride.isPending}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOverride.mutate({ deviceId, featureKey: row.key, enabled: null });
                  }}
                >
                  Clear
                </Button>
              ) : null}
              <Switch
                checked={row.enabled}
                disabled={setOverride.isPending}
                onCheckedChange={(enabled) => {
                  setOverride.mutate({ deviceId, featureKey: row.key, enabled });
                }}
              />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};
