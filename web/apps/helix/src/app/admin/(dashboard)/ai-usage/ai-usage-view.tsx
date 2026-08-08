'use client';

import { useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';
import { Input } from '@helix/design-system/components/input';
import { Switch } from '@helix/design-system/components/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@helix/design-system/components/table';
import { toast } from 'sonner';

import { useTRPCMutation } from '@/server/react';
import type { AppRouter } from '@/server/trpc';

import { UserUsageSheet } from './user-usage-sheet';

import type { inferRouterOutputs } from '@trpc/server';

type Overview = inferRouterOutputs<AppRouter>['aiUsage']['overview'];
type UsageRow = Overview['rows'][number];

const CURRENCY_DIGITS = 4;
const DEFAULT_TOP_UP = '5';

export const formatUsd = (value: number, digits = CURRENCY_DIGITS): string =>
  `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;

const formatTokens = (value: number): string => value.toLocaleString();

/** The whole access state machine at a glance. */
const accessBadge = (row: UsageRow) => {
  if (!row.aiEnabled) {
    return { label: 'Disabled', variant: 'destructive' as const };
  }
  if (row.unlimited) {
    return {
      label: row.configured ? 'Unlimited' : 'Unrestricted',
      variant: 'secondary' as const,
    };
  }
  return row.remainingUsd > 0
    ? { label: `${formatUsd(row.remainingUsd)} left`, variant: 'default' as const }
    : { label: 'Out of credits', variant: 'destructive' as const };
};

const SummaryTile = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border p-4">
    <p className="text-muted-foreground text-xs">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
  </div>
);

export const AiUsageView = ({ overview }: { overview: Overview }) => {
  const router = useRouter();
  const [topUps, setTopUps] = useState<Record<string, string>>({});
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const setAccess = useTRPCMutation((api) => api.aiUsage.setAccess.mutationOptions());
  const grantCredits = useTRPCMutation((api) => api.aiUsage.grantCredits.mutationOptions());

  // Spenders first; users who have never used AI sink to the bottom but stay
  // listed so they can be granted credits.
  const rows = useMemo(
    () => [...overview.rows].sort((left, right) => right.spentUsd - left.spentUsd),
    [overview.rows],
  );

  const updateAccess = async (
    row: UsageRow,
    patch: { aiEnabled?: boolean; unlimited?: boolean },
  ) => {
    try {
      await setAccess.mutateAsync({
        userId: row.userId,
        aiEnabled: patch.aiEnabled ?? row.aiEnabled,
        unlimited: patch.unlimited ?? row.unlimited,
      });
      toast.success('Access updated');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update access');
    }
  };

  const addCredits = async (row: UsageRow) => {
    const amount = Number(topUps[row.userId] ?? DEFAULT_TOP_UP);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error('Enter an amount in dollars, e.g. 5');
      return;
    }
    try {
      const balance = await grantCredits.mutateAsync({ userId: row.userId, amountUsd: amount });
      toast.success(`Credits updated — ${formatUsd(balance.remainingUsd)} remaining`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to grant credits');
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Total spend" value={formatUsd(overview.totals.spentUsd)} />
        <SummaryTile label="Credits granted" value={formatUsd(overview.totals.grantedUsd)} />
        <SummaryTile label="AI requests" value={formatTokens(overview.totals.requests)} />
        <SummaryTile label="Users who used AI" value={String(overview.totals.activeUsers)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By user</CardTitle>
          <CardDescription>
            Cost is computed from the gateway&apos;s per-model prices — the gateway only bills our
            account, so per-user spend is metered here. A user with no limits set is unrestricted;
            granting credits caps them. Click a name for their request history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Spent</TableHead>
                <TableHead className="text-right">Granted</TableHead>
                <TableHead>Controls</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const badge = accessBadge(row);
                return (
                  <TableRow key={row.userId}>
                    <TableCell>
                      <button
                        className="text-left hover:underline"
                        type="button"
                        onClick={() => {
                          setOpenUserId(row.userId);
                        }}
                      >
                        <div className="font-medium">{row.name}</div>
                        <div className="text-muted-foreground text-xs">{row.email}</div>
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTokens(row.requests)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTokens(row.totalTokens)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(row.spentUsd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(row.grantedUsd)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="flex items-center gap-1.5 text-xs">
                          <Switch
                            aria-label={`AI enabled for ${row.name}`}
                            checked={row.aiEnabled}
                            onCheckedChange={(checked) => {
                              void updateAccess(row, { aiEnabled: checked });
                            }}
                          />
                          AI on
                        </span>
                        <span className="flex items-center gap-1.5 text-xs">
                          <Switch
                            aria-label={`Unlimited spend for ${row.name}`}
                            checked={row.unlimited}
                            disabled={!row.aiEnabled}
                            onCheckedChange={(checked) => {
                              void updateAccess(row, { unlimited: checked });
                            }}
                          />
                          Unlimited
                        </span>
                        <div className="flex items-center gap-1">
                          <Input
                            aria-label={`Credit amount for ${row.name}`}
                            className="h-8 w-20"
                            placeholder={DEFAULT_TOP_UP}
                            step="0.01"
                            type="number"
                            value={topUps[row.userId] ?? ''}
                            onChange={(event) => {
                              setTopUps((current) => ({
                                ...current,
                                [row.userId]: event.target.value,
                              }));
                            }}
                          />
                          <Button
                            disabled={grantCredits.isPending}
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void addCredits(row);
                            }}
                          >
                            Add credits
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By feature</CardTitle>
          <CardDescription>
            Every AI surface records into the same ledger, so spend is attributable per feature.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {overview.byFeature.length === 0 ? (
            <p className="text-muted-foreground text-sm">No AI usage yet.</p>
          ) : (
            overview.byFeature.map((row) => (
              <div key={row.feature} className="flex items-center justify-between text-sm">
                <span className="truncate">{row.feature}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatUsd(row.costUsd)} · {formatTokens(row.totalTokens)} tokens ·{' '}
                  {formatTokens(row.requests)} req
                </span>
              </div>
            ))
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
                  {formatUsd(row.costUsd)} · {formatTokens(row.totalTokens)} tokens ·{' '}
                  {formatTokens(row.requests)} req
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <UserUsageSheet
        userId={openUserId}
        onClose={() => {
          setOpenUserId(null);
        }}
      />
    </>
  );
};
