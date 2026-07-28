'use client';

import { useReducedMotion } from 'motion/react';

import { useMounted } from './use-mounted';

/** True only when entrance animations should run: after hydration AND when the
 * user hasn't asked for reduced motion. Components render their plain, fully
 * visible markup whenever this is false — on the server, at the first client
 * render (hydration-safe), and for reduced-motion users — and only opt into
 * `initial`-hidden reveals once this flips true. */
export const useAnimate = (): boolean => {
  const reduce = useReducedMotion() ?? false;
  return useMounted() && !reduce;
};
