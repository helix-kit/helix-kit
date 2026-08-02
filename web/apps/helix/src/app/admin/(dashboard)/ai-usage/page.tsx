import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@helix/design-system/components/table';

import { fetchQuery } from '@/server/server';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI usage',
  robots: { index: false, follow: false },
};

const compact = (value: number): string =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

const StatTile = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border p-4">
    <p className="text-muted-foreground text-xs">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
  </div>
);

export default async function AiUsagePage() {
  const overview = await fetchQuery((trpc) => trpc.agent.usageOverview.queryOptions());

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI usage</h1>
          <p className="text-muted-foreground text-sm">
            Platform-wide assistant usage — tokens, tool calls, and per-user activity.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Requests" value={compact(overview.totals.requests)} />
          <StatTile label="Total tokens" value={compact(overview.totals.totalTokens)} />
          <StatTile label="Tool calls" value={compact(overview.totals.toolCalls)} />
          <StatTile label="Active users" value={compact(overview.totals.activeUsers)} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>By user</CardTitle>
            <CardDescription>Ranked by total tokens.</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.byUser.length === 0 ? (
              <p className="text-muted-foreground text-sm">No AI usage yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Tool calls</TableHead>
                    <TableHead className="text-right">Last used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.byUser.map((row) => (
                    <TableRow key={row.userId}>
                      <TableCell>
                        <div className="font-medium">{row.name}</div>
                        <div className="text-muted-foreground text-xs">{row.email}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {compact(row.requests)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {compact(row.totalTokens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {compact(row.toolCalls)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs">
                        {new Date(row.lastUsedAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {overview.byModel.length === 0 ? (
              <p className="text-muted-foreground text-sm">No AI usage yet.</p>
            ) : (
              overview.byModel.map((row) => (
                <div key={row.model} className="flex items-center justify-between text-sm">
                  <span className="truncate font-mono text-xs">{row.model}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {compact(row.totalTokens)} tokens · {compact(row.requests)} req
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
