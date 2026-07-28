import type * as React from 'react';

import { cn } from '@helix/design-system/lib/utils';

const Card = ({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<'div'> & { size?: 'default' | 'sm' }) => (
  <div
    className={cn(
      'group/card bg-card text-card-foreground ring-foreground/10 flex flex-col gap-4 overflow-hidden rounded-lg py-4 text-xs/relaxed ring-1 has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-2 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-lg *:[img:last-child]:rounded-lg',
      className,
    )}
    data-size={size}
    data-slot="card"
    {...props}
  />
);

const CardHeader = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn(
      'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-lg px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3',
      className,
    )}
    data-slot="card-header"
    {...props}
  />
);

const CardTitle = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn('font-heading text-sm font-medium group-data-[size=sm]/card:text-sm', className)}
    data-slot="card-title"
    {...props}
  />
);

const CardDescription = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn('text-muted-foreground text-xs/relaxed', className)}
    data-slot="card-description"
    {...props}
  />
);

const CardAction = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
    data-slot="card-action"
    {...props}
  />
);

const CardContent = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn('px-4 group-data-[size=sm]/card:px-3', className)}
    data-slot="card-content"
    {...props}
  />
);

const CardFooter = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn(
      'flex items-center rounded-lg border-t p-4 group-data-[size=sm]/card:p-3',
      className,
    )}
    data-slot="card-footer"
    {...props}
  />
);

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
