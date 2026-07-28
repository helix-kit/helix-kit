'use client';

import { useQuery } from '@tanstack/react-query';

import type { iceRouter } from '@helix/backend/ice';
import type { IceServer } from '@helix/protocol-peer';

import { useDeviceAppApi } from '../trpc';

type IceRouter = ReturnType<typeof iceRouter>;

// Well inside the credential TTL (an hour by default), so a session never opens
// with an expired TURN credential.
const ICE_STALE_MINUTES = 10;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const ICE_STALE_MS = ICE_STALE_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

/**
 * The ICE servers for a P2P session: public STUN, plus short-lived TURN
 * credentials minted for the signed-in user.
 *
 * The browser passes these on to the device in the `open` command, so both peers
 * gather against the same relay and the device needs no cloud credentials of its
 * own. They expire, so fetch them per session rather than caching them for the
 * life of the page.
 */
export const useIceServers = (
  enabled: boolean,
): { iceServers: readonly IceServer[]; isLoading: boolean } => {
  const api = useDeviceAppApi<IceRouter>('ice');
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
