'use client';

import type { ComponentProps, ReactNode } from 'react';

import { motion, type Variants } from 'motion/react';

import { useAnimate } from './use-animate';

/** Shared easing — a soft "out-expo"-ish curve used across every reveal. */
const EASE = [0.16, 1, 0.3, 1] as const;

const VIEWPORT = { once: true, margin: '0px 0px -12% 0px' } as const;

/** Fade + rise item variants, opted into by children of <Stagger>. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

type DivProps = Omit<ComponentProps<typeof motion.div>, 'children'>;

type RevealProps = DivProps & {
  children: ReactNode;
  /** Seconds to wait before animating in. */
  delay?: number;
  /** Pixels to rise from. */
  y?: number;
};

/** Fades + rises into view; renders plain and visible until animation is enabled, so content is never stuck hidden. */
export const Reveal = ({ children, delay = 0, y = 24, ...props }: RevealProps) => {
  const animate = useAnimate();
  if (!animate) {
    return <motion.div {...props}>{children}</motion.div>;
  }
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      transition={{ duration: 0.6, ease: EASE, delay }}
      viewport={VIEWPORT}
      whileInView={{ opacity: 1, y: 0 }}
      {...props}
    >
      {children}
    </motion.div>
  );
};

type StaggerProps = DivProps & {
  children: ReactNode;
  /** Seconds between each child's entrance. */
  stagger?: number;
};

/** Container that drives a staggered entrance for its <StaggerItem> children. */
export const Stagger = ({ children, stagger = 0.08, ...props }: StaggerProps) => {
  const animate = useAnimate();
  if (!animate) {
    return <motion.div {...props}>{children}</motion.div>;
  }
  return (
    <motion.div
      initial="hidden"
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger } } }}
      viewport={VIEWPORT}
      whileInView="show"
      {...props}
    >
      {children}
    </motion.div>
  );
};

type StaggerItemProps = DivProps & { children: ReactNode };

/** A child of <Stagger> — inherits the parent's animation timeline. */
export const StaggerItem = ({ children, ...props }: StaggerItemProps) => {
  const animate = useAnimate();
  return (
    <motion.div variants={animate ? fadeUp : undefined} {...props}>
      {children}
    </motion.div>
  );
};
