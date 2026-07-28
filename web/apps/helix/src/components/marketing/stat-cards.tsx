'use client';

import { heroStats } from '@/lib/landing';

import { CountUp } from './motion/count-up';
import { Stagger, StaggerItem } from './motion/reveal';

export const StatCards = () => (
  <Stagger className="grid grid-cols-4 gap-3" stagger={0.08}>
    {heroStats.map((s) => (
      <StaggerItem
        key={s.label}
        className="border-border/70 bg-card/90 hover:border-brand/40 rounded-lg border p-3 text-center backdrop-blur-sm transition-colors"
      >
        <div className="font-heading text-brand text-2xl font-semibold tabular-nums">
          <CountUp suffix={s.suffix} to={s.value} />
        </div>
        <p className="text-muted-foreground mt-1 text-[11px] leading-tight">{s.label}</p>
      </StaggerItem>
    ))}
  </Stagger>
);
