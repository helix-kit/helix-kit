'use client';

import { useMemo, useState, type ReactNode } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@helix-hq/design-system/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@helix-hq/design-system/components/dialog';
import { Input } from '@helix-hq/design-system/components/input';
import { Label } from '@helix-hq/design-system/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@helix-hq/design-system/components/select';
import { Switch } from '@helix-hq/design-system/components/switch';
import { toast } from 'sonner';

import { useTRPCMutation } from '@/server/react';
import type { AppRouter } from '@/server/trpc';

import type { inferRouterOutputs } from '@trpc/server';

type TrackOptions = inferRouterOutputs<AppRouter>['profiles']['trackOptions'];
type TrackRow = NonNullable<inferRouterOutputs<AppRouter>['profiles']['get']>['tracks'][number];
type SelectorKey = { key: string; required?: boolean };

const selectorKeysOf = (type: TrackOptions['types'][number] | undefined): SelectorKey[] =>
  Array.isArray(type?.selectorKeys) ? (type.selectorKeys as SelectorKey[]) : [];

const SelectField = ({
  value,
  onChange,
  placeholder,
  disabled,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  options: { label: string; value: string }[];
}) => (
  <Select disabled={disabled} value={value} onValueChange={onChange}>
    <SelectTrigger className="w-full">
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent>
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export const TrackDialog = ({
  profileId,
  options,
  track,
  trigger,
}: {
  profileId: string;
  options: TrackOptions;
  track?: TrackRow['track'];
  trigger: ReactNode;
}) => {
  const router = useRouter();
  const isEdit = track !== undefined;
  const [open, setOpen] = useState(false);

  const [typeKey, setTypeKey] = useState(track?.typeKey ?? '');
  const [releaseName, setReleaseName] = useState(track?.releaseName ?? '');
  const [followMode, setFollowMode] = useState<'channel' | 'pin'>(
    track?.pinnedReleaseId != null ? 'pin' : 'channel',
  );
  const [channel, setChannel] = useState(track?.channel ?? '');
  const [pinnedReleaseId, setPinnedReleaseId] = useState(track?.pinnedReleaseId ?? '');
  const [autoUpdate, setAutoUpdate] = useState(track?.autoUpdate ?? true);
  const [selector, setSelector] = useState<Record<string, string>>(
    () => (track?.selector as Record<string, string> | null) ?? {},
  );

  const selectorKeys = useMemo(
    () => selectorKeysOf(options.types.find((type) => type.key === typeKey)),
    [options.types, typeKey],
  );
  const releaseNames = useMemo(
    () => options.releaseLines.filter((line) => line.typeKey === typeKey).map((line) => line.name),
    [options.releaseLines, typeKey],
  );
  const pinReleases = useMemo(
    () => options.releases.filter((r) => r.typeKey === typeKey && r.name === releaseName),
    [options.releases, typeKey, releaseName],
  );

  const add = useTRPCMutation((api) => api.profiles.addTrack.mutationOptions());
  const edit = useTRPCMutation((api) => api.profiles.updateTrack.mutationOptions());
  const mutation = isEdit ? edit : add;

  const submit = () => {
    const chosenChannel = channel === '' ? null : channel;
    const chosenPin = pinnedReleaseId === '' ? null : pinnedReleaseId;
    const config = {
      channel: followMode === 'channel' ? chosenChannel : null,
      pinnedReleaseId: followMode === 'pin' ? chosenPin : null,
      selector,
      autoUpdate,
    };
    if (config.channel === null && config.pinnedReleaseId === null) {
      toast.error('Choose a channel to follow or a release to pin');
      return;
    }
    const onDone = {
      onSuccess: () => {
        toast.success(isEdit ? 'Track updated' : 'Track added');
        setOpen(false);
        router.refresh();
      },
      onError: (error: { message: string }) => toast.error(error.message),
    };
    if (isEdit) {
      edit.mutate({ trackId: track.id, ...config }, onDone);
    } else {
      if (typeKey === '' || releaseName === '') {
        toast.error('Pick a type and release line');
        return;
      }
      add.mutate({ profileId, typeKey, releaseName, ...config }, onDone);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit track' : 'Add track'}</DialogTitle>
          <DialogDescription>
            A track resolves to a release the assigned devices should run.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Artifact type</Label>
            <SelectField
              disabled={isEdit}
              options={options.types.map((type) => ({ label: type.displayName, value: type.key }))}
              placeholder="Select a type"
              value={typeKey}
              onChange={(value) => {
                setTypeKey(value);
                setReleaseName('');
                setPinnedReleaseId('');
                setSelector({});
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Release line</Label>
            <SelectField
              disabled={isEdit || typeKey === ''}
              options={releaseNames.map((name) => ({ label: name, value: name }))}
              placeholder={typeKey === '' ? 'Pick a type first' : 'Select a release line'}
              value={releaseName}
              onChange={(value) => {
                setReleaseName(value);
                setPinnedReleaseId('');
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Follow</Label>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                size="sm"
                type="button"
                variant={followMode === 'channel' ? 'default' : 'outline'}
                onClick={() => {
                  setFollowMode('channel');
                }}
              >
                Latest on channel
              </Button>
              <Button
                className="flex-1"
                size="sm"
                type="button"
                variant={followMode === 'pin' ? 'default' : 'outline'}
                onClick={() => {
                  setFollowMode('pin');
                }}
              >
                Pin a release
              </Button>
            </div>
          </div>

          {followMode === 'channel' ? (
            <div className="grid gap-1.5">
              <Label>Channel</Label>
              <SelectField
                options={options.channels.map((c) => ({ label: c, value: c }))}
                placeholder="Select a channel"
                value={channel}
                onChange={setChannel}
              />
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label>Release</Label>
              <SelectField
                disabled={releaseName === ''}
                options={pinReleases.map((r) => ({
                  label: `${r.version} · ${r.channel} · ${r.status}`,
                  value: r.id,
                }))}
                placeholder={releaseName === '' ? 'Pick a release line first' : 'Select a release'}
                value={pinnedReleaseId}
                onChange={setPinnedReleaseId}
              />
            </div>
          )}

          {selectorKeys.length > 0 ? (
            <div className="grid gap-1.5">
              <Label>Selector</Label>
              <p className="text-muted-foreground text-xs">
                Picks the variant within the resolved release (leave blank to not constrain).
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {selectorKeys.map((sk) => (
                  <div key={sk.key} className="grid gap-1">
                    <Label className="text-muted-foreground text-xs" htmlFor={`sel-${sk.key}`}>
                      {sk.key}
                      {sk.required === true ? ' *' : ''}
                    </Label>
                    <Input
                      id={`sel-${sk.key}`}
                      value={selector[sk.key] ?? ''}
                      onChange={(event) => {
                        const next = { ...selector };
                        if (event.target.value === '') {
                          delete next[sk.key];
                        } else {
                          next[sk.key] = event.target.value;
                        }
                        setSelector(next);
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <div className="grid gap-0.5">
              <Label htmlFor="auto-update">Auto-update</Label>
              <span className="text-muted-foreground text-xs">
                Advance OTA when the resolved release moves.
              </span>
            </div>
            <Switch checked={autoUpdate} id="auto-update" onCheckedChange={setAutoUpdate} />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={mutation.isPending} onClick={submit}>
            {isEdit ? 'Save' : 'Add track'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
