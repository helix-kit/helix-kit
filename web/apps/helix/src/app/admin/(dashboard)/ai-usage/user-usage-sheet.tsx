'use client';

import { Badge } from '@helix-hq/design-system/components/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@helix-hq/design-system/components/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@helix-hq/design-system/components/table';

import { useTRPCQuery } from '@/server/react';

import { formatUsd } from './ai-usage-view';

/** Per-request costs are fractions of a cent, so they need the full precision. */
const MICRO_DIGITS = 6;

const formatWhen = (value: Date | string): string => new Date(value).toLocaleString();

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border p-3">
    <p className="text-muted-foreground text-xs">{label}</p>
    <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
  </div>
);

export const UserUsageSheet = ({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) => {
  const detail = useTRPCQuery((api) => ({
    ...api.aiUsage.userDetail.queryOptions({ userId: userId ?? '' }),
    enabled: userId !== null,
  }));

  return (
    <Sheet
      open={userId !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {/* The side variant is required: a plain `sm:max-w-*` loses to the default. */}
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle>AI usage detail</SheetTitle>
          <SheetDescription>Spend, recent requests, and credit grants.</SheetDescription>
        </SheetHeader>

        {detail.isPending || detail.data === undefined ? (
          <p className="text-muted-foreground p-4 text-sm">Loading…</p>
        ) : (
          <div className="space-y-6 p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Spent" value={formatUsd(detail.data.balance.spentUsd)} />
              <Metric label="Granted" value={formatUsd(detail.data.balance.grantedUsd)} />
              <Metric
                label="Remaining"
                value={
                  detail.data.balance.unlimited ? '∞' : formatUsd(detail.data.balance.remainingUsd)
                }
              />
              <Metric label="Requests" value={String(detail.data.events.length)} />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Recent requests</p>
              {detail.data.events.length === 0 ? (
                <p className="text-muted-foreground text-sm">No AI usage yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">In</TableHead>
                      <TableHead className="text-right">Out</TableHead>
                      <TableHead className="text-right">Cached</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.data.events.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatWhen(event.createdAt)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{event.model}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {event.inputTokens.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {event.outputTokens.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {event.cachedInputTokens.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatUsd(Number(event.costUsd), MICRO_DIGITS)}
                          {event.costEstimated ? (
                            <Badge className="ml-1" variant="outline">
                              est
                            </Badge>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Credit grants</p>
              {detail.data.grants.length === 0 ? (
                <p className="text-muted-foreground text-sm">No credits granted.</p>
              ) : (
                <div className="space-y-1">
                  {detail.data.grants.map((grant) => (
                    <div key={grant.id} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground text-xs">
                        {formatWhen(grant.createdAt)}
                        {grant.note != null && grant.note !== '' ? ` · ${grant.note}` : ''}
                      </span>
                      <span className="tabular-nums">{formatUsd(Number(grant.amountUsd))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
