'use client';

import { motion } from 'motion/react';

import { statusLines } from '@/lib/landing';

import { TerminalWindow } from './terminal-window';

import { useAnimate } from '../motion/use-animate';

const line = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0 },
};

export const StatusTerminal = () => {
  const animate = useAnimate();

  return (
    <TerminalWindow live title="helix --status">
      <motion.div
        className="grid gap-0.5"
        initial={animate ? 'hidden' : undefined}
        variants={
          animate ? { hidden: {}, show: { transition: { staggerChildren: 0.12 } } } : undefined
        }
        viewport={{ once: true }}
        whileInView={animate ? 'show' : undefined}
      >
        <motion.p className="text-muted-foreground mb-2" variants={animate ? line : undefined}>
          <span className="text-brand">$</span> helix --status
        </motion.p>
        {statusLines.map((s) => (
          <motion.p key={s.key} className="flex" variants={animate ? line : undefined}>
            <span className="text-muted-foreground inline-block w-28">{s.key}</span>
            <span className="text-brand">{s.value}</span>
          </motion.p>
        ))}
        <motion.p className="text-foreground mt-3" variants={animate ? line : undefined}>
          All systems Helix.
          <span className="bg-brand ml-1 inline-block h-3.5 w-2 translate-y-0.5 animate-[terminal-caret_1s_step-end_infinite]" />
        </motion.p>
      </motion.div>
    </TerminalWindow>
  );
};
