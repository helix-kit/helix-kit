'use client';

import { useState } from 'react';

import { Button } from '@helix/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';
import { DeleteConfirmDialog } from '@helix/design-system/components/delete-confirm-dialog';
import { Input } from '@helix/design-system/components/input';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { authClient } from '@/lib/auth-client';

type PasskeyRow = {
  id: string;
  name?: string | null;
  createdAt: string | Date;
};

const formatDate = (value: string | Date): string => new Date(value).toLocaleDateString();

export const PasskeysCard = () => {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const passkeysQuery = useQuery({
    queryKey: ['settings', 'passkeys'],
    queryFn: async (): Promise<PasskeyRow[]> => {
      const result = await authClient.passkey.listUserPasskeys();
      if (result.error != null) {
        throw new Error(result.error.message ?? 'Failed to load passkeys');
      }
      return result.data as PasskeyRow[];
    },
  });
  const passkeys = passkeysQuery.data ?? [];

  const add = async () => {
    setAdding(true);
    const result = await authClient.passkey.addPasskey({
      name: name.trim() === '' ? undefined : name.trim(),
    });
    setAdding(false);
    if (result.error != null) {
      toast.error(result.error.message ?? 'Failed to add passkey');
      return;
    }
    setName('');
    toast.success('Passkey added');
    void passkeysQuery.refetch();
  };

  const remove = async (id: string) => {
    setBusyId(id);
    const result = await authClient.passkey.deletePasskey({ id });
    setBusyId(null);
    if (result.error != null) {
      toast.error(result.error.message ?? 'Failed to delete passkey');
      return;
    }
    toast.success('Passkey removed');
    void passkeysQuery.refetch();
  };

  const renderBody = () => {
    if (passkeysQuery.isPending) {
      return <p className="text-muted-foreground text-sm">Loading…</p>;
    }
    if (passkeys.length === 0) {
      return <p className="text-muted-foreground text-sm">No passkeys yet.</p>;
    }
    return (
      <div className="space-y-2">
        {passkeys.map((passkey) => (
          <div key={passkey.id} className="flex items-center gap-3 rounded-md border p-3">
            <KeyRound className="text-muted-foreground size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{passkey.name ?? 'Passkey'}</p>
              <p className="text-muted-foreground truncate text-xs">
                Added {formatDate(passkey.createdAt)}
              </p>
            </div>
            <DeleteConfirmDialog
              description="You will no longer be able to sign in with this passkey."
              isPending={busyId === passkey.id}
              title={`Remove "${passkey.name ?? 'Passkey'}"?`}
              trigger={
                <Button size="icon" variant="ghost">
                  <Trash2 />
                </Button>
              }
              onConfirm={() => remove(passkey.id)}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passkeys</CardTitle>
        <CardDescription>
          Sign in without a password using device biometrics or a security key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            aria-label="New passkey name"
            placeholder="Passkey name (optional)"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <Button disabled={adding} onClick={add}>
            {adding ? 'Waiting…' : 'Add passkey'}
          </Button>
        </div>
        {renderBody()}
      </CardContent>
    </Card>
  );
};
