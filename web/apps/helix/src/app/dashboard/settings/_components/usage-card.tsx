'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';

import { useTRPCQuery } from '@/server/react';

const compact = (value: number): string =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

const StatTile = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border p-3">
    <p className="text-muted-foreground text-xs">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
  </div>
);

const BAR_MIN_HEIGHT_PCT = 4;
const FULL_PCT = 100;

export const UsageCard = () => {
  const usageQuery = useTRPCQuery((api) => api.agent.myUsage.queryOptions());
  const { data } = usageQuery;

  const maxDaily = Math.max(1, ...(data?.daily.map((day) => day.totalTokens) ?? [1]));

  const renderBody = () => {
    if (usageQuery.isPending) {
      return <p className="text-muted-foreground text-sm">Loading…</p>;
    }
    if (data === undefined || data.totals.requests === 0) {
      return <p className="text-muted-foreground text-sm">No AI usage yet.</p>;
    }
    return (
      <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Requests" value={compact(data.totals.requests)} />
          <StatTile label="Total tokens" value={compact(data.totals.totalTokens)} />
          <StatTile label="Tool calls" value={compact(data.totals.toolCalls)} />
          <StatTile
            label="In / Out tokens"
            value={`${compact(data.totals.inputTokens)} / ${compact(data.totals.outputTokens)}`}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">By model</p>
          <div className="space-y-1">
            {data.byModel.map((row) => (
              <div key={row.model} className="flex items-center justify-between text-sm">
                <span className="truncate font-mono text-xs">{row.model}</span>
                <span className="text-muted-foreground tabular-nums">
                  {compact(row.totalTokens)} tokens · {compact(row.requests)} req
                </span>
              </div>
            ))}
          </div>
        </div>

        {data.daily.length > 0 ? (
          <div>
            <p className="mb-2 text-sm font-medium">Last 30 days (tokens)</p>
            <div className="flex h-24 items-end gap-0.5">
              {data.daily.map((day) => (
                <div
                  key={day.day}
                  className="bg-primary/70 hover:bg-primary min-w-0 flex-1 rounded-t-sm"
                  style={{
                    height: `${Math.max(BAR_MIN_HEIGHT_PCT, (day.totalTokens / maxDaily) * FULL_PCT)}%`,
                  }}
                  title={`${day.day}: ${day.totalTokens.toLocaleString()} tokens, ${day.requests} req`}
                />
              ))}
            </div>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI usage</CardTitle>
        <CardDescription>Your assistant activity — tokens, tool calls, and models.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">{renderBody()}</CardContent>
    </Card>
  );
};
