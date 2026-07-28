'use client';

import { useReducedMotion } from 'motion/react';

import { useMounted } from './use-mounted';

/** True only when entrance animations should run: after hydration and when the user hasn't asked for reduced motion. */
export const useAnimate = (): boolean => {
  const reduce = useReducedMotion() ?? false;
  return useMounted() && !reduce;
};
