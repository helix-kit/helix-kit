'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** False on the server and the first client render (via getServerSnapshot),
 * true afterwards — a hydration-safe "have we mounted yet?" flag. Use it to gate
 * decorative, animation-only elements so the server and client render the same
 * markup at hydration time regardless of the user's reduced-motion preference. */
export const useMounted = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
