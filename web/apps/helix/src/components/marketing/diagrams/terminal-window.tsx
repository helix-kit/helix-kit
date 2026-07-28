import type { ReactNode } from 'react';

import { cn } from '@helix/design-system/lib/utils';

/** Reusable terminal chrome (traffic-light dots + title + optional LIVE badge). */
export const TerminalWindow = ({
  title,
  live = false,
  className,
  children,
}: {
  title?: string;
  live?: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <div
    className={cn(
      'dark border-border/70 overflow-hidden rounded-xl border bg-[#0a0e13] text-foreground shadow-2xl shadow-black/40',
      className,
    )}
  >
    <div className="border-border/60 flex items-center gap-2 border-b bg-white/[0.02] px-4 py-2.5">
      <span className="flex gap-1.5">
        <span className="size-2.5 rounded-full bg-red-500/70" />
        <span className="size-2.5 rounded-full bg-yellow-500/70" />
        <span className="size-2.5 rounded-full bg-green-500/70" />
      </span>
      {title != null && title !== '' ? (
        <span className="text-muted-foreground ml-2 font-mono text-xs">{title}</span>
      ) : null}
      {live ? (
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-green-400">
          <span className="size-1.5 animate-pulse rounded-full bg-green-400" />
          LIVE
        </span>
      ) : null}
    </div>
    <div className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">{children}</div>
  </div>
);
