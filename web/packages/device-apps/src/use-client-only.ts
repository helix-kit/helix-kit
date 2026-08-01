'use client';

import { useSyncExternalStore } from 'react';

const subscribe = (): (() => void) => () => {};

const getServerSnapshot = (): null => null;

export const useClientOnly = <TValue>(getSnapshot: () => TValue): TValue | null =>
  useSyncExternalStore<TValue | null>(subscribe, getSnapshot, getServerSnapshot);
