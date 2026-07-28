'use client';

import { useEffect, useState } from 'react';

const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 3600;
const SHORT_ID_LENGTH = 8;

// A monotonically-updating "now" (unix ms) for live relative timestamps. Shared
// by the device-app session lists (shell, port-forward) so ages tick smoothly.
export const useNow = (intervalMs: number = SECOND_MS): number => {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [intervalMs]);
  return now;
};

// "12s", "5m", "1h 3m" — a compact session age from a unix-ms timestamp.
export const formatAge = (createdAtMs: number, now: number): string => {
  const seconds = Math.max(0, Math.floor((now - createdAtMs) / SECOND_MS));
  if (seconds < MINUTE_S) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / MINUTE_S);
  if (seconds < HOUR_S) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / MINUTE_S)}h ${minutes % MINUTE_S}m`;
};

// A shortened session id for display, e.g. "a1b2c3d4".
export const shortId = (sessionId: string): string => sessionId.slice(0, SHORT_ID_LENGTH);
