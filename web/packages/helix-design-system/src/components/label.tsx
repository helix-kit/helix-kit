'use client';

import type * as React from 'react';

import { cn } from '@helix-hq/design-system/lib/utils';
import { Label as LabelPrimitive } from 'radix-ui';

const Label = ({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) => (
  <LabelPrimitive.Root
    className={cn(
      'flex items-center gap-2 text-xs leading-none select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
      className,
    )}
    data-slot="label"
    {...props}
  />
);

export { Label };
