'use client';

import { cn } from '@helix/design-system/lib/utils';
import { Eye } from 'lucide-react';
import { motion } from 'motion/react';

import { architecture } from '@/lib/landing';

import { iconMap } from '../icon-map';
import { useAnimate } from '../motion/use-animate';

const Node = ({
  icon,
  label,
  sub,
  accent = false,
}: {
  icon?: string;
  label: string;
  sub?: string;
  accent?: boolean;
}) => {
  const Icon = icon != null ? iconMap[icon] : undefined;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 transition-colors',
        accent
          ? 'border-brand/40 bg-brand/[0.06]'
          : 'border-border/70 bg-card/40 hover:border-brand/40',
      )}
    >
      {Icon != null ? <Icon className="text-brand size-4 shrink-0" /> : null}
      <div className="leading-tight">
        <div className="text-foreground text-xs font-medium whitespace-nowrap">{label}</div>
        {sub != null ? (
          <div className="text-muted-foreground text-[10px] whitespace-nowrap">{sub}</div>
        ) : null}
      </div>
    </div>
  );
};

const FlowArrow = ({ label, delay = 0 }: { label?: string; delay?: number }) => (
  <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-1">
    {label != null ? (
      <span className="text-muted-foreground/70 text-center font-mono text-[9px] leading-tight whitespace-pre">
        {label}
      </span>
    ) : null}
    <div className="via-brand/50 relative h-px w-12 bg-gradient-to-r from-transparent to-transparent">
      <span
        className="bg-brand-light absolute top-1/2 size-2 -translate-y-1/2 [animation:flow-right_1.6s_ease-in-out_infinite] rounded-full shadow-[0_0_10px_2px_var(--color-brand)] motion-reduce:hidden"
        style={{ animationDelay: `${delay}s` }}
      />
      <span className="border-brand/50 absolute top-1/2 -right-0.5 size-1.5 -translate-y-1/2 rotate-45 border-t border-r" />
    </div>
  </div>
);

const GroupLabel = ({ children, className }: { children: string; className?: string }) => (
  <span className={cn('mb-1 font-mono text-[10px] tracking-widest uppercase', className)}>
    {children}
  </span>
);

export const ArchitectureDiagram = () => {
  const animate = useAnimate();

  return (
    <motion.div
      className="border-border/70 bg-card/20 rounded-2xl border p-5 md:p-8"
      initial={animate ? { opacity: 0, y: 24 } : undefined}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      whileInView={animate ? { opacity: 1, y: 0 } : undefined}
    >
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-[880px] items-center gap-3">
          <div className="flex flex-col gap-2">
            <GroupLabel className="text-brand">Devices</GroupLabel>
            {architecture.devices.map((d) => (
              <Node key={d.label} icon={d.icon} label={d.label} />
            ))}
          </div>

          <FlowArrow delay={0} label={'MQTT / MQTTs\nTLS mTLS'} />

          <div className="flex flex-col gap-2">
            <GroupLabel className="text-brand">Edge / Gateways</GroupLabel>
            {architecture.edge.map((e) => (
              <Node key={e.label} accent label={e.label} sub={e.sub} />
            ))}
          </div>

          <FlowArrow delay={0.3} />

          <div className="flex flex-col gap-2">
            <GroupLabel className="text-transparent">Broker</GroupLabel>
            <Node accent label={architecture.broker.label} sub={architecture.broker.sub} />
          </div>

          <FlowArrow delay={0.6} />

          <div className="flex flex-col gap-2">
            <GroupLabel className="text-fuchsia-400">Cloud Control Plane</GroupLabel>
            <div className="flex gap-2">
              <div className="grid gap-2">
                {architecture.cloud.map((c) => (
                  <Node key={c.label} label={c.label} sub={'sub' in c ? c.sub : undefined} />
                ))}
              </div>
              <div className="flex flex-col justify-center gap-2">
                {architecture.controlPlane.map((c) => (
                  <Node key={c.label} accent label={c.label} sub={c.sub} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-border/60 mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t pt-4">
        <Eye className="text-muted-foreground/60 size-3.5" />
        {architecture.baseline.map((b) => (
          <span key={b} className="text-muted-foreground font-mono text-[11px]">
            {b}
          </span>
        ))}
      </div>
    </motion.div>
  );
};
