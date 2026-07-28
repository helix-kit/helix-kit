'use client';

import { useState } from 'react';

import { cn } from '@helix/design-system/lib/utils';
import { Minus, Plus, Radio } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { layers } from '@/lib/landing';

import { iconMap } from '../icon-map';
import { useAnimate } from '../motion/use-animate';

export const LayersAccordion = () => {
  const reduce = useReducedMotion() ?? false;
  const animate = useAnimate();
  const [open, setOpen] = useState<string>(layers[0].slug);

  return (
    <div className="grid gap-3">
      {layers.map((layer, i) => {
        const Icon = iconMap[layer.icon] ?? Radio;
        const isOpen = open === layer.slug;
        return (
          <motion.div
            key={layer.slug}
            className={cn(
              'overflow-hidden rounded-xl border transition-colors',
              isOpen
                ? 'border-brand/50 bg-card/50'
                : 'border-border/70 bg-card/25 hover:border-border',
            )}
            initial={animate ? { opacity: 0, y: 16 } : undefined}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: i * 0.06 }}
            viewport={{ once: true, margin: '0px 0px -12% 0px' }}
            whileInView={animate ? { opacity: 1, y: 0 } : undefined}
          >
            <button
              className="flex w-full items-center gap-4 px-5 py-4 text-left"
              type="button"
              onClick={() => {
                setOpen(isOpen ? '' : layer.slug);
              }}
            >
              <span
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-lg border transition-colors',
                  isOpen
                    ? 'border-brand/50 bg-brand/10 text-brand'
                    : 'border-border/70 bg-muted/40 text-muted-foreground',
                )}
              >
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-medium', isOpen && 'text-brand')}>
                  {layer.name}
                </span>
                <span className="text-muted-foreground mt-0.5 block text-xs">{layer.summary}</span>
              </span>
              <span className="text-muted-foreground shrink-0">
                {isOpen ? <Minus className="size-4" /> : <Plus className="size-4" />}
              </span>
            </button>

            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  key="body"
                  animate={reduce ? undefined : { height: 'auto', opacity: 1 }}
                  className="overflow-hidden"
                  exit={reduce ? undefined : { height: 0, opacity: 0 }}
                  initial={reduce ? undefined : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                >
                  <p className="text-muted-foreground border-border/50 mx-5 mb-4 border-t pt-3 text-sm/6">
                    {layer.detail}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
};
