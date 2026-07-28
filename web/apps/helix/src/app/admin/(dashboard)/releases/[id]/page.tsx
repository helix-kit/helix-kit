import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
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
import { ArrowLeft } from 'lucide-react';

import { fetchQuery } from '@/server/server';
import type { AppRouter } from '@/server/trpc';

import type { inferRouterOutputs } from '@trpc/server';

type ReleaseDetail = NonNullable<inferRouterOutputs<AppRouter>['releases']['getById']>;
type VariantWithArtifacts = ReleaseDetail['variants'][number];
type ArtifactLink = VariantWithArtifacts['artifacts'][number];

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const KB = 1024;
const UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const SHORT_HASH_LENGTH = 12;

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) {
    return '—';
  }
  let value = bytes;
  let unit = 0;
  while (value >= KB && unit < UNITS.length - 1) {
    value /= KB;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`;
};

const shortHash = (value: string | null): string =>
  value === null ? '—' : value.slice(0, SHORT_HASH_LENGTH);

// Compact key/value grid used for the metadata card.
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid gap-0.5">
    <dt className="text-muted-foreground text-xs">{label}</dt>
    <dd className="text-sm">{children}</dd>
  </div>
);

const JsonBlock = ({ value }: { value: unknown }) => (
  <pre className="bg-muted/40 text-muted-foreground max-h-80 overflow-auto rounded-md border p-3 text-xs">
    {JSON.stringify(value, null, 2)}
  </pre>
);

const ArtifactRow = ({ artifact }: { artifact: ArtifactLink }) => (
  <TableRow>
    <TableCell className="font-medium">{artifact.role}</TableCell>
    <TableCell>
      <Badge className="font-normal" variant="secondary">
        {artifact.storageMode}
      </Badge>
    </TableCell>
    <TableCell className="font-mono text-xs">
      {artifact.storageMode === 'ref'
        ? `${artifact.coordinate ?? '?'}@${artifact.refVersion ?? '?'}`
        : shortHash(artifact.sha256)}
    </TableCell>
    <TableCell className="text-muted-foreground text-xs">
      {artifact.storageMode === 'ref'
        ? shortHash(artifact.digest)
        : formatBytes(artifact.sizeBytes)}
    </TableCell>
    <TableCell className="text-muted-foreground font-mono text-xs">
      {artifact.offset ?? '—'}
    </TableCell>
  </TableRow>
);

const VariantCard = ({ variant }: { variant: VariantWithArtifacts }) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base">{variant.name ?? 'Variant'}</CardTitle>
      <CardDescription className="font-mono text-xs">
        {JSON.stringify(variant.selector)}
      </CardDescription>
    </CardHeader>
    <CardContent>
      {variant.artifacts.length === 0 ? (
        <p className="text-muted-foreground text-sm">No artifacts.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Storage</TableHead>
              <TableHead>SHA-256 / Ref</TableHead>
              <TableHead>Size / Digest</TableHead>
              <TableHead>Offset</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variant.artifacts.map((artifact) => (
              <ArtifactRow key={artifact.artifactId} artifact={artifact} />
            ))}
          </TableBody>
        </Table>
      )}
    </CardContent>
  </Card>
);

const ReleaseDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const detail = await fetchQuery((trpc) => trpc.releases.getById.queryOptions({ id }));
  if (detail === null) {
    notFound();
  }

  const { release, variants } = detail;

  return (
    // Plain scroll box + a natural-height inner grid. A `grid h-full` scroll
    // container sizes its rows to the fixed height and clips each card's content.
    <div className="h-full overflow-y-auto">
      <div className="grid gap-6 p-4 sm:p-6">
        <div className="grid gap-2">
          <Button asChild className="text-muted-foreground -ml-2.5 w-fit" size="sm" variant="ghost">
            <Link href="/admin/releases">
              <ArrowLeft />
              Releases
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{release.name}</h1>
            <span className="text-muted-foreground font-mono text-sm">{release.version}</span>
            <Badge variant={release.status === 'ready' ? 'default' : 'outline'}>
              {release.status === 'ready' ? 'Ready' : 'Draft'}
            </Badge>
            <Badge variant="secondary">{release.channel}</Badge>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Type">{release.typeKey}</Field>
              <Field label="Release ID">
                <span className="font-mono text-xs">{release.id}</span>
              </Field>
              <Field label="Source commit">
                <span className="font-mono text-xs">
                  {release.sourceCommit === null
                    ? '—'
                    : release.sourceCommit.slice(0, SHORT_HASH_LENGTH)}
                  {release.sourceDirty ? ' (dirty)' : ''}
                </span>
              </Field>
              <Field label="Owner">{release.ownerUserId ?? '—'}</Field>
              <Field label="Build">
                <span className="font-mono text-xs">{release.buildId ?? '—'}</span>
              </Field>
              <Field label="Created">{dateFormatter.format(release.createdAt)}</Field>
              <Field label="Published">
                {release.publishedAt === null ? '—' : dateFormatter.format(release.publishedAt)}
              </Field>
            </dl>
          </CardContent>
        </Card>

        {Object.keys(release.config as Record<string, unknown>).length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Config</CardTitle>
            </CardHeader>
            <CardContent>
              <JsonBlock value={release.config} />
            </CardContent>
          </Card>
        ) : null}

        {release.analysis !== null ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <JsonBlock value={release.analysis} />
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            Variants <span className="text-muted-foreground font-normal">({variants.length})</span>
          </h2>
          <div className="grid gap-4">
            {variants.map((variant) => (
              <VariantCard key={variant.id} variant={variant} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReleaseDetailPage;
