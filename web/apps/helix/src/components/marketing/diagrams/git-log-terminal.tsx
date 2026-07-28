'use client';

import { motion } from 'motion/react';

import { gitLog } from '@/lib/landing';

import { TerminalWindow } from './terminal-window';

import { useAnimate } from '../motion/use-animate';

const line = { hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } };
const avatars = [
  'from-brand to-brand-deep',
  'from-fuchsia-500 to-purple-600',
  'from-sky-400 to-blue-600',
];

export const GitLogTerminal = () => {
  const animate = useAnimate();

  return (
    <TerminalWindow title="git log">
      <motion.div
        className="grid gap-1"
        initial={animate ? 'hidden' : undefined}
        variants={
          animate ? { hidden: {}, show: { transition: { staggerChildren: 0.15 } } } : undefined
        }
        viewport={{ once: true }}
        whileInView={animate ? 'show' : undefined}
      >
        <motion.p className="text-muted-foreground mb-1" variants={animate ? line : undefined}>
          <span className="text-brand">$</span> git log --oneline -n 3
        </motion.p>
        {gitLog.map((c) => (
          <motion.p key={c.hash} variants={animate ? line : undefined}>
            <span className="text-yellow-500/80">{c.hash}</span>{' '}
            <span className="text-foreground/80">{c.msg}</span>
          </motion.p>
        ))}
      </motion.div>

      <div className="border-border/50 text-muted-foreground mt-4 flex items-center justify-between border-t pt-3 text-xs">
        <span>Pushed 2m ago</span>
        <span className="flex items-center">
          <span className="flex -space-x-2">
            {avatars.map((a) => (
              <span
                key={a}
                className={`ring-background size-6 rounded-full bg-gradient-to-br ring-2 ${a}`}
              />
            ))}
          </span>
          <span className="ml-2">+24</span>
        </span>
      </div>
    </TerminalWindow>
  );
};
