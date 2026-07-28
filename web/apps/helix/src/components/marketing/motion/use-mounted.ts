'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** Hydration-safe "have we mounted yet?" flag: false on the server and first client render, true afterwards. */
export const useMounted = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
