'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { Badge } from '@helix-hq/design-system/components/badge';
import { Button } from '@helix-hq/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix-hq/design-system/components/card';
import { useQuery } from '@tanstack/react-query';
import { Monitor } from 'lucide-react';
import { toast } from 'sonner';

import { authClient, useSession } from '@/lib/auth-client';

type SessionRow = {
  id: string;
  token: string;
  createdAt: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg/, 'Edge'],
  [/Chrome/, 'Chrome'],
  [/Firefox/, 'Firefox'],
  [/Safari/, 'Safari'],
];
const OSES: ReadonlyArray<readonly [RegExp, string]> = [
  [/Windows/, 'Windows'],
  [/Mac OS/, 'macOS'],
  [/Android/, 'Android'],
  [/iPhone|iPad|iOS/, 'iOS'],
  [/Linux/, 'Linux'],
];

// A coarse, dependency-free label from a user-agent string.
const describeAgent = (userAgent: string | null | undefined): string => {
  if (userAgent == null || userAgent === '') {
    return 'Unknown device';
  }
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Browser';
  const os = OSES.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Unknown OS';
  return `${browser} on ${os}`;
};

const formatDate = (value: string | Date): string => new Date(value).toLocaleString();

export const SessionsCard = () => {
  const router = useRouter();
  const { data: current } = useSession();
  const [busyToken, setBusyToken] = useState<string | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ['settings', 'sessions'],
    queryFn: async (): Promise<SessionRow[]> => {
      const result = await authClient.listSessions();
      if (result.error != null) {
        throw new Error(result.error.message ?? 'Failed to load sessions');
      }
      return result.data as SessionRow[];
    },
  });
  const sessions = sessionsQuery.data ?? [];

  const revoke = async (token: string) => {
    setBusyToken(token);
    const result = await authClient.revokeSession({ token });
    setBusyToken(null);
    if (result.error != null) {
      toast.error(result.error.message ?? 'Failed to revoke session');
      return;
    }
    if (token === current?.session.token) {
      router.push('/auth/login');
      return;
    }
    toast.success('Session revoked');
    void sessionsQuery.refetch();
  };

  const renderBody = () => {
    if (sessionsQuery.isPending) {
      return <p className="text-muted-foreground text-sm">Loading…</p>;
    }
    if (sessions.length === 0) {
      return <p className="text-muted-foreground text-sm">No active sessions.</p>;
    }
    return sessions.map((session) => {
      const isCurrent = session.token === current?.session.token;
      return (
        <div key={session.id} className="flex items-center gap-3 rounded-md border p-3">
          <Monitor className="text-muted-foreground size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">
                {describeAgent(session.userAgent)}
              </span>
              {isCurrent ? <Badge variant="secondary">This device</Badge> : null}
            </div>
            <p className="text-muted-foreground truncate text-xs">
              {session.ipAddress != null && session.ipAddress !== ''
                ? `${session.ipAddress} · `
                : ''}
              Signed in {formatDate(session.createdAt)}
            </p>
          </div>
          <Button
            disabled={busyToken === session.token}
            size="sm"
            variant={isCurrent ? 'outline' : 'ghost'}
            onClick={() => revoke(session.token)}
          >
            {isCurrent ? 'Sign out' : 'Revoke'}
          </Button>
        </div>
      );
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices currently signed in to your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{renderBody()}</CardContent>
    </Card>
  );
};
