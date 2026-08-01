'use client';

import { Badge } from '@helix/design-system/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

export type FirmwareBuildStatus = {
  status: string;
  releaseId: string | null;
  durationMs: number | null;
  errorSummary: string | null;
} | null;

export type BuildStatusPanelProps = {
  buildId: string | null;
  status: FirmwareBuildStatus;
  cacheHit?: boolean;
  releaseId?: string | null;
  releaseHref?: (releaseId: string) => string;
};

const MS_PER_SECOND = 1000;

const formatDuration = (ms: number | null): string | null => {
  if (ms === null) {
    return null;
  }
  if (ms < MS_PER_SECOND) {
    return `${ms} ms`;
  }
  return `${(ms / MS_PER_SECOND).toFixed(1)} s`;
};

const headline = (isPending: boolean, isFailed: boolean): string => {
  if (isPending) {
    return 'Building…';
  }
  return isFailed ? 'Build failed' : 'Build complete';
};

const badgeVariant = (
  isPending: boolean,
  isFailed: boolean,
): 'default' | 'secondary' | 'destructive' => {
  if (isFailed) {
    return 'destructive';
  }
  return isPending ? 'secondary' : 'default';
};

export const BuildStatusPanel = ({
  buildId,
  status,
  cacheHit = false,
  releaseId,
  releaseHref,
}: BuildStatusPanelProps) => {
  if (buildId === null) {
    return null;
  }

  const effectiveStatus = cacheHit ? 'success' : (status?.status ?? 'queued');
  const isPending = effectiveStatus === 'queued';
  const isFailed = effectiveStatus === 'failed';
  const resolvedReleaseId = releaseId ?? status?.releaseId ?? null;
  const duration = formatDuration(status?.durationMs ?? null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {effectiveStatus === 'success' && <CheckCircle2 className="size-4 text-emerald-500" />}
            {isFailed ? <XCircle className="text-destructive size-4" /> : null}
            {headline(isPending, isFailed)}
          </CardTitle>
          <Badge variant={badgeVariant(isPending, isFailed)}>{effectiveStatus}</Badge>
        </div>
        <CardDescription>
          <code>{buildId}</code>
          {cacheHit ? ' — reused an existing identical build (Tier-0 cache hit).' : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {duration !== null && (
          <div className="text-muted-foreground">
            Build time: <span className="text-foreground">{duration}</span>
          </div>
        )}
        {resolvedReleaseId !== null && (
          <div>
            Release:{' '}
            {releaseHref !== undefined ? (
              <a className="text-primary underline" href={releaseHref(resolvedReleaseId)}>
                {resolvedReleaseId}
              </a>
            ) : (
              <code>{resolvedReleaseId}</code>
            )}
          </div>
        )}
        {isFailed && status?.errorSummary != null ? (
          <pre className="bg-muted max-h-64 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
            {status.errorSummary}
          </pre>
        ) : null}
        {isPending ? (
          <p className="text-muted-foreground text-xs">
            The build container is compiling the firmware and will register a release when done.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};
