import { headers } from 'next/headers';
import Link from 'next/link';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';
import { BookOpen, Cpu, Shield } from 'lucide-react';

import { getSessionUser } from '@/server/require-admin';

const DashboardPage = async () => {
  const user = await getSessionUser(await headers());
  const firstName = user?.name.split(/\s+/)[0] ?? 'there';

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col gap-6 overflow-auto p-4 sm:p-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
        <p className="text-muted-foreground text-sm">
          This is your Helix workspace. Explore the platform and manage your account.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="text-brand size-4" />
              Your account
            </CardTitle>
            <CardDescription>Signed in to Helix</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="font-medium">{user?.name}</p>
            <p className="text-muted-foreground">{user?.email}</p>
          </CardContent>
        </Card>

        <Link className="group" href="/docs">
          <Card className="group-hover:border-brand/50 h-full transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="text-brand size-4" />
                Documentation
              </CardTitle>
              <CardDescription>Guides for building on the Helix platform</CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              Learn how the protocol, firmware, edge OS, and cloud fit together.
            </CardContent>
          </Card>
        </Link>

        {user?.isAdmin === true ? (
          <Link className="group" href="/admin">
            <Card className="group-hover:border-brand/50 h-full transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="text-brand size-4" />
                  Admin console
                </CardTitle>
                <CardDescription>Manage users, devices, releases, and builds</CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">
                Administrative tools for operating the platform.
              </CardContent>
            </Card>
          </Link>
        ) : null}
      </div>
    </div>
  );
};

export default DashboardPage;
