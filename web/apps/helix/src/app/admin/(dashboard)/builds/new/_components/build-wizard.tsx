'use client';

import { useRef, useState } from 'react';

import { type BuildCatalog } from '@helix/backend/releases';
import {
  BuildStatusPanel,
  FirmwareBuilderForm,
  type FirmwareBuildValues,
} from '@helix/firmware-builder';
import { toast } from 'sonner';

import { useTRPCMutation, useTRPCQuery } from '@/server/react';

const POLL_INTERVAL_MS = 2000;

const isTerminal = (status: string | undefined): boolean =>
  status === 'success' || status === 'failed';

export const BuildWizard = ({ catalog }: { catalog: BuildCatalog }) => {
  const [buildId, setBuildId] = useState<string | null>(null);
  const [cacheHit, setCacheHit] = useState(false);
  const [hitReleaseId, setHitReleaseId] = useState<string | null>(null);
  // Latch a terminal build so polling stops. A ref (updated during render) rather
  // than state, so there is no setState-in-effect and no extra render.
  const doneRef = useRef(false);

  const request = useTRPCMutation((api) =>
    api.releases.builds.request.mutationOptions({
      onSuccess: (result) => {
        setBuildId(result.buildId);
        setCacheHit(result.status === 'hit');
        setHitReleaseId(result.status === 'hit' ? result.releaseId : null);
        toast.success(
          result.status === 'hit'
            ? 'An identical build already exists — reused it.'
            : 'Build queued.',
        );
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const statusQuery = useTRPCQuery((api) => ({
    ...api.releases.builds.get.queryOptions({ id: buildId ?? '' }),
    enabled: buildId !== null && !cacheHit && !doneRef.current,
    refetchInterval: POLL_INTERVAL_MS,
  }));

  const status = statusQuery.data ?? null;
  if (isTerminal(status?.status)) {
    doneRef.current = true;
  }

  const handleSubmit = (values: FirmwareBuildValues) => {
    doneRef.current = false;
    setBuildId(null);
    setCacheHit(false);
    setHitReleaseId(null);
    request.mutate(values);
  };

  return (
    <div className="flex flex-col gap-6">
      <FirmwareBuilderForm
        catalog={catalog}
        submitting={request.isPending}
        onSubmit={handleSubmit}
      />
      <BuildStatusPanel
        buildId={buildId}
        cacheHit={cacheHit}
        releaseHref={(id) => `/admin/releases/${id}`}
        releaseId={hitReleaseId}
        status={status}
      />
    </div>
  );
};
