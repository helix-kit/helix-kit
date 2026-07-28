'use client';

import { motion } from 'motion/react';

import { communityMessages } from '@/lib/landing';

import { useAnimate } from '../motion/use-animate';

const avatarTints = [
  'from-brand to-brand-deep',
  'from-fuchsia-500 to-purple-600',
  'from-sky-400 to-blue-600',
];

export const CommunityChat = () => {
  const animate = useAnimate();

  return (
    <div className="border-border/70 bg-card/30 rounded-xl border p-4">
      <div className="text-muted-foreground mb-3 font-mono text-[10px] tracking-widest uppercase">
        Community
      </div>
      <motion.div
        className="grid gap-3"
        initial={animate ? 'hidden' : undefined}
        variants={
          animate ? { hidden: {}, show: { transition: { staggerChildren: 0.4 } } } : undefined
        }
        viewport={{ once: true }}
        whileInView={animate ? 'show' : undefined}
      >
        {communityMessages.map((m, i) => (
          <motion.div
            key={m.handle}
            className="flex items-start gap-3"
            variants={
              animate ? { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } } : undefined
            }
          >
            <span
              className={`mt-0.5 size-7 shrink-0 rounded-full bg-gradient-to-br ${avatarTints[i % avatarTints.length]}`}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-foreground text-xs font-medium">@{m.handle}</span>
                <span className="text-muted-foreground/60 text-[10px]">{m.time}</span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-sm">{m.text}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
};
