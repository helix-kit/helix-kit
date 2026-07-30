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
import { DialogFooter } from '@helix/design-system/components/dialog';
import { Input } from '@helix/design-system/components/input';
import { ResponsiveModal } from '@helix/design-system/components/responsive-modal';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { authClient } from '@/lib/auth-client';

type ApiKeyRow = {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: string | Date;
  expiresAt: string | Date | null;
};

const formatDate = (value: string | Date): string => new Date(value).toLocaleDateString();

export const ApiKeysCard = () => {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const keysQuery = useQuery({
    queryKey: ['settings', 'api-keys'],
    queryFn: async (): Promise<ApiKeyRow[]> => {
      const result = await authClient.apiKey.list();
      if (result.error != null) {
        throw new Error(result.error.message ?? 'Failed to load API keys');
      }
      const {data} = result;
      const list = Array.isArray(data) ? data : ((data as { apiKeys?: unknown[] }).apiKeys ?? []);
      return list as ApiKeyRow[];
    },
  });
  const keys = keysQuery.data ?? [];

  const create = async () => {
    setCreating(true);
    const result = await authClient.apiKey.create({
      name: name.trim() === '' ? 'API key' : name.trim(),
    });
    setCreating(false);
    if (result.error != null) {
      toast.error(result.error.message ?? 'Failed to create API key');
      return;
    }
    setName('');
    setCopied(false);
    setRevealed({ name: result.data.name ?? 'API key', key: result.data.key });
    void keysQuery.refetch();
  };

  const remove = async (id: string) => {
    setBusyId(id);
    const result = await authClient.apiKey.delete({ keyId: id });
    setBusyId(null);
    if (result.error != null) {
      toast.error(result.error.message ?? 'Failed to delete API key');
      return;
    }
    toast.success('API key deleted');
    void keysQuery.refetch();
  };

  const copyKey = async () => {
    if (revealed == null) {
      return;
    }
    await navigator.clipboard.writeText(revealed.key);
    setCopied(true);
    toast.success('Copied to clipboard');
  };

  const renderBody = () => {
    if (keysQuery.isPending) {
      return <p className="text-muted-foreground text-sm">Loading…</p>;
    }
    if (keys.length === 0) {
      return <p className="text-muted-foreground text-sm">No API keys yet.</p>;
    }
    return (
      <div className="space-y-2">
        {keys.map((key) => (
          <div key={key.id} className="flex items-center gap-3 rounded-md border p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{key.name ?? 'API key'}</p>
              <p className="text-muted-foreground truncate text-xs">
                {key.start != null ? `${key.start}··· · ` : ''}Created {formatDate(key.createdAt)}
                {key.expiresAt != null ? ` · Expires ${formatDate(key.expiresAt)}` : ''}
              </p>
            </div>
            <DeleteConfirmDialog
              description="Any client using this key will immediately lose access. This cannot be undone."
              isPending={busyId === key.id}
              title={`Delete "${key.name ?? 'API key'}"?`}
              trigger={
                <Button size="icon" variant="ghost">
                  <Trash2 />
                </Button>
              }
              onConfirm={() => remove(key.id)}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          Personal keys for the Helix MCP server and API. Send as the{' '}
          <code className="text-xs">x-api-key</code> header. A key is shown only once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            aria-label="New API key name"
            placeholder="Key name (e.g. Claude Desktop)"
            value={name}
            onChange={(event) => { setName(event.target.value); }}
          />
          <Button disabled={creating} onClick={create}>
            {creating ? 'Creating…' : 'Create key'}
          </Button>
        </div>
        {renderBody()}
      </CardContent>

      <ResponsiveModal
        description="Copy it now — this key is shown only once and cannot be retrieved later."
        open={revealed !== null}
        title={revealed === null ? undefined : `API key "${revealed.name}"`}
        onOpenChange={(open) => {
          if (!open) {
            setRevealed(null);
          }
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1.5 text-sm">
            {revealed?.key}
          </code>
          <Button size="icon" variant="outline" onClick={copyKey}>
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={() => { setRevealed(null); }}>Done</Button>
        </DialogFooter>
      </ResponsiveModal>
    </Card>
  );
};
