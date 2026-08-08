'use client';

import { Badge } from '@helix/design-system/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';

import { useTRPCQuery } from '@/server/react';

const CURRENCY_DIGITS = 4;
const MICRO_DIGITS = 6;
const BAR_MIN_HEIGHT_PCT = 4;
const FULL_PCT = 100;

const compact = (value: number): string =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

const formatUsd = (value: number, digits = CURRENCY_DIGITS): string =>
  `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;

const formatWhen = (value: Date | string): string => new Date(value).toLocaleString();

const StatTile = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border p-3">
    <p className="text-muted-foreground text-xs">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
  </div>
);

export const UsageCard = () => {
  const usageQuery = useTRPCQuery((api) => api.aiUsage.mine.queryOptions());
  const { data } = usageQuery;

  const maxDaily = Math.max(1, ...(data?.daily.map((day) => day.costUsd) ?? [1]));

  const renderBody = () => {
    if (usageQuery.isPending || data === undefined) {
      return <p className="text-muted-foreground text-sm">Loading…</p>;
    }

    const { balance } = data;
    // An unconfigured account is unrestricted; only show a balance once an admin
    // has actually capped the user, otherwise "remaining" is meaningless.
    const capped = balance.aiEnabled && !balance.unlimited;

    const creditsLabel = () => {
      if (!balance.aiEnabled) {
        return '—';
      }
      return balance.unlimited ? '∞' : formatUsd(balance.remainingUsd);
    };

    const notice = () => {
      if (!balance.aiEnabled) {
        return 'AI features are turned off for your account. Ask an administrator to enable them.';
      }
      if (capped && balance.remainingUsd <= 0) {
        return 'You have used all of your AI credits. Ask an administrator to add more.';
      }
      return null;
    };
    const noticeText = notice();

    return (
      <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Spent" value={formatUsd(data.totals.costUsd)} />
          <StatTile label="Credits left" value={creditsLabel()} />
          <StatTile label="Requests" value={compact(data.totals.requests)} />
          <StatTile label="Total tokens" value={compact(data.totals.totalTokens)} />
        </div>

        {noticeText === null ? null : <p className="text-destructive text-sm">{noticeText}</p>}

        {data.totals.requests === 0 ? (
          <p className="text-muted-foreground text-sm">No AI usage yet.</p>
        ) : (
          <>
            <div>
              <p className="mb-2 text-sm font-medium">By feature</p>
              <div className="space-y-1">
                {data.byFeature.map((row) => (
                  <div key={row.feature} className="flex items-center justify-between text-sm">
                    <span className="truncate">{row.feature}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatUsd(row.costUsd)} · {compact(row.totalTokens)} tokens ·{' '}
                      {compact(row.requests)} req
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">By model</p>
              <div className="space-y-1">
                {data.byModel.map((row) => (
                  <div key={row.model} className="flex items-center justify-between text-sm">
                    <span className="truncate font-mono text-xs">{row.model}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatUsd(row.costUsd)} · {compact(row.totalTokens)} tokens ·{' '}
                      {compact(row.requests)} req
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {data.daily.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium">Last 30 days (spend)</p>
                <div className="flex h-24 items-end gap-0.5">
                  {data.daily.map((day) => (
                    <div
                      key={day.day}
                      className="bg-primary/70 hover:bg-primary min-w-0 flex-1 rounded-t-sm"
                      style={{
                        height: `${Math.max(BAR_MIN_HEIGHT_PCT, (day.costUsd / maxDaily) * FULL_PCT)}%`,
                      }}
                      title={`${day.day}: ${formatUsd(day.costUsd)}, ${day.requests} req`}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-sm font-medium">Recent requests</p>
              <div className="space-y-1">
                {data.recent.map((event) => (
                  <div key={event.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0">
                      {formatWhen(event.createdAt)}
                    </span>
                    <span className="truncate font-mono">{event.model}</span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {compact(event.totalTokens)} tok ·{' '}
                      {formatUsd(Number(event.costUsd), MICRO_DIGITS)}
                      {event.costEstimated ? (
                        <Badge className="ml-1" variant="outline">
                          est
                        </Badge>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI usage</CardTitle>
        <CardDescription>
          Your AI spend across every Helix feature — credits, tokens, and recent requests.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">{renderBody()}</CardContent>
    </Card>
  );
};
