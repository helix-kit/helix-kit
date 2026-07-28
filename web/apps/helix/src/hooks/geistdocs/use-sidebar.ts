'use client';

import { useSyncExternalStore } from 'react';

let isOpen = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => isOpen;

const getServerSnapshot = () => false;

const setIsOpen = (next: boolean) => {
  isOpen = next;
  listeners.forEach((listener) => {
    listener();
  });
};

export const useSidebarContext = () => {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    isOpen: open,
    setIsOpen,
  };
};
