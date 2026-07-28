import Link from 'next/link';

import { cn } from '@helix/design-system/lib/utils';

export const HelixMark = ({ className }: { className?: string }) => (
  <svg
    aria-hidden
    className={cn('size-6', className)}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
  >
    <path className="opacity-90" d="M5 3c0 6 14 6 14 12s-14 6-14 12" />
    <path className="text-brand" d="M19 3c0 6-14 6-14 12s14 6 14 12" stroke="currentColor" />
    <path className="opacity-40" d="M7 8h10M7 16h10" />
  </svg>
);

export const Logo = ({ className }: { className?: string }) => (
  <Link
    className={cn(
      'text-foreground flex items-center gap-2 font-semibold tracking-tight',
      className,
    )}
    href="/"
  >
    <span className="text-brand">
      <HelixMark />
    </span>
    <span className="text-base">Helix</span>
  </Link>
);
