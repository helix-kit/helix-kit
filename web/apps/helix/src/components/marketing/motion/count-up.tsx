'use client';

import { useEffect, useRef, useState } from 'react';

import { animate, useInView, useReducedMotion } from 'motion/react';

/** Counts from 0 → `to` the first time it scrolls into view; static under reduced motion. */
export const CountUp = ({ to, suffix = '' }: { to: number; suffix?: string }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -15% 0px' });
  const reduce = useReducedMotion() ?? false;
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) {
      return;
    }
    const controls = animate(0, to, {
      duration: reduce ? 0 : 1.1,
      ease: 'easeOut',
      onUpdate: (v) => {
        setValue(Math.round(v));
      },
    });
    return () => {
      controls.stop();
    };
  }, [inView, reduce, to]);

  // Render `value` (0 on server and first client render) to stay hydration-safe regardless of reduced-motion preference.
  return (
    <span ref={ref}>
      {value}
      {suffix}
    </span>
  );
};
