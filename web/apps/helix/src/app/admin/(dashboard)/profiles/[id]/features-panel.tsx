'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix-hq/design-system/components/card';
import { Switch } from '@helix-hq/design-system/components/switch';
import { toast } from 'sonner';

import { useTRPCMutation, useTRPCQuery } from '@/server/react';

// Which cloud features this profile enables for its devices.
export const FeaturesPanel = ({ profileId }: { profileId: string }) => {
  const features = useTRPCQuery((api) => api.features.profileFeatures.queryOptions({ profileId }));
  const setFeature = useTRPCMutation((api) =>
    api.features.setProfileFeature.mutationOptions({
      onSuccess: () => void features.refetch(),
      onError: (error) => toast.error(error.message),
    }),
  );

  const rows = features.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Features</CardTitle>
        <CardDescription>
          Cloud features enabled for devices on this profile. Disabled by default.
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
              <span className="flex-1 truncate font-mono text-sm">{row.key}</span>
              <Switch
                checked={row.enabled}
                disabled={setFeature.isPending}
                onCheckedChange={(enabled) => {
                  setFeature.mutate({ profileId, featureKey: row.key, enabled });
                }}
              />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};
