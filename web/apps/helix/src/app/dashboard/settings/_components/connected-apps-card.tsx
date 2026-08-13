'use client';

import { Badge } from '@helix-hq/design-system/components/badge';
import { Button } from '@helix-hq/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix-hq/design-system/components/card';
import { DeleteConfirmDialog } from '@helix-hq/design-system/components/delete-confirm-dialog';
import { Plug } from 'lucide-react';
import { toast } from 'sonner';

import { useTRPCMutation, useTRPCQuery } from '@/server/react';

import type { ConnectedApps } from './settings-view';

const formatDate = (value: string | Date): string => new Date(value).toLocaleDateString();

export const ConnectedAppsCard = ({ initialApps }: { initialApps: ConnectedApps }) => {
  const query = useTRPCQuery((api) => ({
    ...api.account.listConnectedApps.queryOptions(),
    initialData: initialApps,
  }));
  const revoke = useTRPCMutation((api) =>
    api.account.revokeConnectedApp.mutationOptions({
      onSuccess: () => {
        toast.success('Access revoked');
        void query.refetch();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const apps = query.data ?? initialApps;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected apps</CardTitle>
        <CardDescription>
          Third-party apps (e.g. MCP clients) you authorized via OAuth. Revoking signs the app out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {apps.length === 0 ? (
          <p className="text-muted-foreground text-sm">No connected apps.</p>
        ) : (
          apps.map((app) => (
            <div key={app.clientId} className="flex items-center gap-3 rounded-md border p-3">
              <Plug className="text-muted-foreground size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{app.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {app.scopes.map((scope) => (
                    <Badge key={scope} className="text-xs" variant="outline">
                      {scope}
                    </Badge>
                  ))}
                  <span className="text-muted-foreground text-xs">
                    Authorized {formatDate(app.authorizedAt)}
                  </span>
                </div>
              </div>
              <DeleteConfirmDialog
                description="The app will lose access to your account and must be re-authorized to reconnect."
                isPending={revoke.isPending}
                title={`Revoke ${app.name}?`}
                trigger={
                  <Button size="sm" variant="ghost">
                    Revoke
                  </Button>
                }
                onConfirm={() => {
                  revoke.mutate({ clientId: app.clientId });
                }}
              />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};
