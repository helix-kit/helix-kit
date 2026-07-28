'use client';

import type * as React from 'react';

import { cn } from '@helix/design-system/lib/utils';

type TableActionsProps = React.ComponentProps<'div'>;

export const TableActions = ({ className, ...props }: TableActionsProps) => (
  <div
    className={cn('flex min-w-max flex-nowrap items-center gap-2 whitespace-nowrap', className)}
    data-slot="table-actions"
    {...props}
  />
);
