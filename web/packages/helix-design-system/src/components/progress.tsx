'use client';

import type * as React from 'react';

import { cn } from '@helix-hq/design-system/lib/utils';
import { Progress as ProgressPrimitive } from 'radix-ui';

const PROGRESS_FULL = 100;

const Progress = ({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) => (
  <ProgressPrimitive.Root
    className={cn(
      'bg-muted relative flex h-1 w-full items-center overflow-x-hidden rounded-md',
      className,
    )}
    data-slot="progress"
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="bg-primary size-full flex-1 transition-all"
      data-slot="progress-indicator"
      style={{ transform: `translateX(-${PROGRESS_FULL - (value ?? 0)}%)` }}
    />
  </ProgressPrimitive.Root>
);

export { Progress };
