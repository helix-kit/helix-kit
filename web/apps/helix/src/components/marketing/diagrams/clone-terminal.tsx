'use client';

import { motion } from 'motion/react';

import { cloneCommands } from '@/lib/landing';

import { TerminalWindow } from './terminal-window';

import { useAnimate } from '../motion/use-animate';

const line = { hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } };

export const CloneTerminal = () => {
  const animate = useAnimate();

  return (
    <TerminalWindow title="bash">
      <motion.div
        className="grid gap-1.5"
        initial={animate ? 'hidden' : undefined}
        variants={
          animate ? { hidden: {}, show: { transition: { staggerChildren: 0.25 } } } : undefined
        }
        viewport={{ once: true }}
        whileInView={animate ? 'show' : undefined}
      >
        {cloneCommands.map((cmd) => (
          <motion.p key={cmd} variants={animate ? line : undefined}>
            <span className="text-brand">$</span> <span className="text-foreground/85">{cmd}</span>
          </motion.p>
        ))}
        <motion.p variants={animate ? line : undefined}>
          <span className="bg-brand inline-block h-3.5 w-2 translate-y-0.5 animate-[terminal-caret_1s_step-end_infinite]" />
        </motion.p>
      </motion.div>
    </TerminalWindow>
  );
};
