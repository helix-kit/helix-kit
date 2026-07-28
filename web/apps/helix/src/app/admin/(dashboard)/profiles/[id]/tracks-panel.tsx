'use client';

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
import { DeleteConfirmDialog } from '@helix/design-system/components/delete-confirm-dialog';
import { CircleAlert, CircleCheck, Pencil, Pin, Plus, Radio, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { useTRPCMutation } from '@/server/react';
import type { AppRouter } from '@/server/trpc';

import { TrackDialog } from './track-dialog';

import type { inferRouterOutputs } from '@trpc/server';

type ProfileDetail = inferRouterOutputs<AppRouter>['profiles']['get'];
type TrackEntry = NonNullable<ProfileDetail>['tracks'][number];
type TrackOptions = inferRouterOutputs<AppRouter>['profiles']['trackOptions'];

const UNRESOLVED_LABEL: Record<string, string> = {
  'no-release': 'No release — nothing published on this channel / pin missing',
  'no-variant': 'No ready variant matches the selector',
};

const Resolution = ({ resolution }: { resolution: TrackEntry['resolution'] }) => {
  if (resolution.status === 'resolved' && resolution.release !== null) {
    return (
      <div className="flex items-center gap-1.5 text-sm">
        <CircleCheck className="text-brand size-4" />
        <span className="font-medium">{resolution.release.version}</span>
        {resolution.variant !== null ? (
          <span className="text-muted-foreground text-xs">
            · {resolution.variant.name ?? 'variant'} · {resolution.artifacts.length} artifact
            {resolution.artifacts.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <CircleAlert className="size-4" />
      {UNRESOLVED_LABEL[resolution.status] ?? 'Unresolved'}
    </div>
  );
};

const TrackCard = ({
  entry,
  profileId,
  options,
}: {
  entry: TrackEntry;
  profileId: string;
  options: TrackOptions;
}) => {
  const router = useRouter();
  const { track } = entry;
  const remove = useTRPCMutation((api) =>
    api.profiles.removeTrack.mutationOptions({
      onSuccess: () => {
        toast.success('Track removed');
        router.refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const selector = (track.selector as Record<string, string> | null) ?? {};
  const selectorEntries = Object.entries(selector);

  return (
    <div className="border-border/60 grid gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{track.releaseName}</span>
          <Badge className="font-normal" variant="secondary">
            {track.typeKey}
          </Badge>
          {track.pinnedReleaseId !== null ? (
            <Badge className="gap-1 font-normal" variant="outline">
              <Pin className="size-3" />
              pinned
            </Badge>
          ) : (
            <Badge className="gap-1 font-normal" variant="outline">
              <Radio className="size-3" />
              {track.channel}
            </Badge>
          )}
          {track.autoUpdate ? (
            <Badge className="font-normal" variant="secondary">
              auto-update
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <TrackDialog
            options={options}
            profileId={profileId}
            track={track}
            trigger={
              <Button aria-label="Edit track" className="size-8" size="icon" variant="ghost">
                <Pencil />
              </Button>
            }
          />
          <DeleteConfirmDialog
            description="Remove this track from the profile? Assigned devices will stop resolving it."
            isPending={remove.isPending}
            title="Remove track?"
            trigger={
              <Button
                aria-label="Remove track"
                className="size-8"
                size="icon"
                variant="destructive"
              >
                <Trash2 />
              </Button>
            }
            onConfirm={() => {
              remove.mutate({ trackId: track.id });
            }}
          />
        </div>
      </div>

      {selectorEntries.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selectorEntries.map(([key, value]) => (
            <Badge key={key} className="font-mono text-[10px] font-normal" variant="outline">
              {key}={value}
            </Badge>
          ))}
        </div>
      ) : null}

      <Resolution resolution={entry.resolution} />
    </div>
  );
};

export const TracksPanel = ({
  profileId,
  tracks,
  options,
}: {
  profileId: string;
  tracks: TrackEntry[];
  options: TrackOptions;
}) => (
  <Card>
    <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
      <div className="grid gap-1">
        <CardTitle className="text-base">Tracks</CardTitle>
        <CardDescription>What this profile follows, and what it resolves to now.</CardDescription>
      </div>
      <TrackDialog
        options={options}
        profileId={profileId}
        trigger={
          <Button size="sm">
            <Plus />
            Add track
          </Button>
        }
      />
    </CardHeader>
    <CardContent className="grid gap-2">
      {tracks.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No tracks yet — add one to define what runs.
        </p>
      ) : (
        tracks.map((entry) => (
          <TrackCard key={entry.track.id} entry={entry} options={options} profileId={profileId} />
        ))
      )}
    </CardContent>
  </Card>
);
