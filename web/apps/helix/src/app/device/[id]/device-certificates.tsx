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
import { DeleteConfirmDialog } from '@helix/design-system/components/delete-confirm-dialog';
import { toast } from 'sonner';

import { useSession } from '@/lib/auth-client';
import { useTRPCMutation, useTRPCQuery } from '@/server/react';

const ADMIN_ROLES = ['admin', 'sysadmin'];

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const STATE_LABEL: Record<string, string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
};

const stateVariant = (state: string): 'default' | 'destructive' | 'outline' => {
  if (state === 'revoked') {
    return 'destructive';
  }
  return state === 'active' ? 'default' : 'outline';
};

// Admin-only section on the public device page: every certificate step-ca has
// issued to this device, with issuance / expiry timestamps and current state,
// plus a revoke action. Revocation adds the serial to the CRL (enforced by
// mosquitto and the mTLS gateway) and records it here. Renders nothing for
// non-admin viewers.
export const DeviceCertificates = ({ deviceId }: { deviceId: string }) => {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string | null } | undefined)?.role ?? null;
  const isAdmin = role !== null && ADMIN_ROLES.includes(role);

  const certificates = useTRPCQuery((api) => ({
    ...api.deviceCertificates.list.queryOptions({ deviceId }),
    enabled: isAdmin,
  }));
  const revoke = useTRPCMutation((api) =>
    api.deviceCertificates.revoke.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.alreadyRevoked ? 'Certificate already revoked' : 'Certificate revoked',
        );
        void certificates.refetch();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!isAdmin) {
    return null;
  }

  const rows = certificates.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Certificates</CardTitle>
        <CardDescription>
          Client certificates issued to this device by the PKI. Revoking a certificate adds its
          serial to the CRL enforced by the MQTT broker and the mTLS gateway.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No certificates issued.</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="border-border/60 grid gap-2 rounded-md border px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="grid min-w-0 gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="font-normal" variant={stateVariant(row.state)}>
                    {STATE_LABEL[row.state] ?? row.state}
                  </Badge>
                  <span className="text-muted-foreground truncate font-mono text-xs">
                    {row.serialNumber}
                  </span>
                </div>
                <div className="text-muted-foreground grid gap-0.5 text-xs">
                  <span>Issued {dateFormatter.format(row.issuedAt)}</span>
                  <span>Expires {dateFormatter.format(row.notAfter)}</span>
                  {row.revokedAt !== null ? (
                    <span>
                      Revoked {dateFormatter.format(row.revokedAt)}
                      {row.revocationReason !== null ? ` — ${row.revocationReason}` : ''}
                    </span>
                  ) : null}
                </div>
              </div>
              {row.state === 'revoked' ? null : (
                <DeleteConfirmDialog
                  confirmText="Revoke"
                  description={
                    <>
                      This adds serial <span className="font-mono">{row.serialNumber}</span> to the
                      CRL. The device will be rejected by the MQTT broker and the mTLS gateway on
                      its next handshake and must re-enroll for a new certificate.
                    </>
                  }
                  isPending={revoke.isPending}
                  pendingText="Revoking..."
                  title="Revoke certificate?"
                  trigger={
                    <Button className="h-8" size="sm" variant="destructive">
                      Revoke
                    </Button>
                  }
                  onConfirm={() => {
                    revoke.mutate({ certificateId: row.id });
                  }}
                />
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};
