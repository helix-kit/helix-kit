'use client';

import { motion } from 'motion/react';

import { GithubIcon } from '@/components/icons';
import { protocolTransports } from '@/lib/landing';

import { iconMap } from '../icon-map';
import { useAnimate } from '../motion/use-animate';

const FlowLine = ({ className }: { className?: string }) => (
  <div
    className={`via-brand/60 relative h-10 w-px bg-gradient-to-b from-transparent to-transparent ${className ?? ''}`}
  >
    <span className="bg-brand-light absolute left-1/2 size-2 -translate-x-1/2 [animation:flow-down_1.6s_ease-in-out_infinite] rounded-full shadow-[0_0_12px_3px_var(--color-brand)] motion-reduce:hidden" />
  </div>
);

export const ProtocolDiagram = () => {
  const animate = useAnimate();

  return (
    <motion.div
      className="flex flex-col items-center"
      initial={animate ? { opacity: 0, y: 20 } : undefined}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      viewport={{ once: true, margin: '0px 0px -15% 0px' }}
      whileInView={animate ? { opacity: 1, y: 0 } : undefined}
    >
      <div className="border-border/70 bg-card/40 text-muted-foreground rounded-lg border px-5 py-3 text-center text-sm">
        APPLICATION LOGIC <span className="text-foreground/60">(Your Code)</span>
      </div>

      <FlowLine />

      <div className="relative">
        <span
          aria-hidden
          className="border-brand/40 absolute inset-0 [animation:node-pulse_3s_ease-in-out_infinite] rounded-full border motion-reduce:animate-none"
        />
        <div className="border-brand/50 bg-brand/10 text-brand relative rounded-full border px-6 py-2.5 text-sm font-semibold shadow-[0_0_28px_-4px_var(--color-brand)]">
          HELIX PROTOCOL
        </div>
      </div>

      <FlowLine className="h-8" />

      <div className="via-brand/50 h-px w-full max-w-md bg-gradient-to-r from-transparent to-transparent" />

      <div className="mt-0 grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
        {protocolTransports.map((t, i) => {
          const Icon = iconMap[t.icon] ?? GithubIcon;
          return (
            <div key={t.key} className="relative flex flex-col items-center">
              <div className="via-border/70 relative h-4 w-px bg-gradient-to-b from-transparent to-transparent">
                <span
                  className="bg-brand-light absolute left-1/2 size-1.5 -translate-x-1/2 [animation:flow-down_1.4s_ease-in-out_infinite] rounded-full shadow-[0_0_8px_2px_var(--color-brand)] motion-reduce:hidden"
                  style={{ animationDelay: `${i * 0.35}s` }}
                />
              </div>
              <div className="group border-border/70 bg-card/40 hover:border-brand/60 flex w-full flex-col items-center gap-2 rounded-lg border p-4 transition-colors">
                <Icon className="text-brand size-5 transition-transform duration-300 group-hover:scale-110" />
                <span className="text-foreground text-xs font-medium">{t.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-muted-foreground/70 mt-6 flex w-full items-center justify-between font-mono text-[10px] tracking-widest uppercase">
        <span>Local</span>
        <span className="bg-border/60 mx-3 h-px flex-1" />
        {(() => {
          const Globe = iconMap.globe ?? GithubIcon;
          return <Globe className="text-brand/70 size-4" />;
        })()}
        <span className="bg-border/60 mx-3 h-px flex-1" />
        <span>Remote</span>
      </div>
    </motion.div>
  );
};
