'use client';

import { Radio } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import { tools } from '@/lib/landing';

import { iconMap } from '../icon-map';
import { Stagger, StaggerItem } from '../motion/reveal';

export const ToolsGrid = () => {
  const reduce = useReducedMotion() ?? false;

  return (
    <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" stagger={0.08}>
      {tools.map((t) => {
        const Icon = iconMap[t.icon] ?? Radio;
        return (
          <StaggerItem key={t.name} className="h-full">
            <motion.div
              className="group border-border/70 bg-card/30 hover:border-brand/50 hover:shadow-brand/10 flex h-full flex-col items-center gap-3 rounded-xl border p-6 text-center transition-colors hover:shadow-xl"
              whileHover={reduce ? undefined : { y: -4 }}
            >
              <span className="border-border/70 bg-muted/40 text-brand group-hover:bg-brand/10 flex size-14 items-center justify-center rounded-xl border transition-colors">
                <Icon className="size-7 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6" />
              </span>
              <h3 className="text-sm font-semibold">{t.name}</h3>
              <p className="text-muted-foreground text-xs/5">{t.body}</p>
              <span className="border-brand/30 bg-brand/5 text-brand mt-auto rounded-full border px-3 py-1 text-[11px]">
                {t.tag}
              </span>
            </motion.div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
};
