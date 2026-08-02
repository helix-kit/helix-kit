'use client';

import { useFeatureApi } from '@helix/web-core/trpc/feature';
import { useQuery } from '@tanstack/react-query';

import type { iceRouter } from '@helix/backend/ice';
import type { IceServer } from '@helix/protocol/peer';

type IceRouter = ReturnType<typeof iceRouter>;

// Well inside the credential TTL, so a session never opens with an expired TURN credential.
const ICE_STALE_MINUTES = 10;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const ICE_STALE_MS = ICE_STALE_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

// The ICE servers for a P2P session (public STUN + short-lived per-user TURN creds).
// They expire, so fetch per session rather than caching for the life of the page.
export const useIceServers = (
  enabled: boolean,
): { iceServers: readonly IceServer[]; isLoading: boolean } => {
  const api = useFeatureApi<IceRouter>('ice');
  const query = useQuery({
    ...api.config.queryOptions(),
    enabled,
    staleTime: ICE_STALE_MS,
  });

  return {
    iceServers: query.data?.iceServers ?? [],
    isLoading: query.isLoading,
  };
};
