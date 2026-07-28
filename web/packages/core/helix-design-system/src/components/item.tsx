import type * as React from 'react';

import { Separator } from '@helix/design-system/components/separator';
import { cn } from '@helix/design-system/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

const ItemGroup = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn(
      'group/item-group flex w-full flex-col gap-4 has-data-[size=sm]:gap-2.5 has-data-[size=xs]:gap-2',
      className,
    )}
    data-slot="item-group"
    role="list"
    {...props}
  />
);

const ItemSeparator = ({ className, ...props }: React.ComponentProps<typeof Separator>) => (
  <Separator
    className={cn('my-2', className)}
    data-slot="item-separator"
    orientation="horizontal"
    {...props}
  />
);

const itemVariants = cva(
  'group/item flex w-full flex-wrap items-center rounded-md border text-xs transition-colors duration-100 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [a]:transition-colors [a]:hover:bg-muted',
  {
    variants: {
      variant: {
        default: 'border-transparent',
        outline: 'border-border',
        muted: 'border-transparent bg-muted/50',
      },
      size: {
        default: 'gap-2.5 px-3 py-2.5',
        sm: 'gap-2.5 px-3 py-2.5',
        xs: 'gap-2 px-2.5 py-2 in-data-[slot=dropdown-menu-content]:p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const Item = ({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemVariants> & { asChild?: boolean }) => {
  const Comp = asChild ? Slot.Root : 'div';
  return (
    <Comp
      className={cn(itemVariants({ variant, size, className }))}
      data-size={size}
      data-slot="item"
      data-variant={variant}
      {...props}
    />
  );
};

const itemMediaVariants = cva(
  'flex shrink-0 items-center justify-center gap-2 group-has-data-[slot=item-description]/item:translate-y-0.5 group-has-data-[slot=item-description]/item:self-start [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: "[&_svg:not([class*='size-'])]:size-4",
        image:
          'size-10 overflow-hidden rounded-md group-data-[size=sm]/item:size-8 group-data-[size=xs]/item:size-6 [&_img]:size-full [&_img]:object-cover',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const ItemMedia = ({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemMediaVariants>) => (
  <div
    className={cn(itemMediaVariants({ variant, className }))}
    data-slot="item-media"
    data-variant={variant}
    {...props}
  />
);

const ItemContent = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn(
      'flex flex-1 flex-col gap-1 group-data-[size=xs]/item:gap-0 [&+[data-slot=item-content]]:flex-none',
      className,
    )}
    data-slot="item-content"
    {...props}
  />
);

const ItemTitle = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn(
      'line-clamp-1 flex w-fit items-center gap-2 text-xs font-medium underline-offset-4',
      className,
    )}
    data-slot="item-title"
    {...props}
  />
);

const ItemDescription = ({ className, ...props }: React.ComponentProps<'p'>) => (
  <p
    className={cn(
      'text-muted-foreground [&>a:hover]:text-primary line-clamp-2 text-left text-xs/relaxed font-normal group-data-[size=xs]/item:text-xs/relaxed [&>a]:underline [&>a]:underline-offset-4',
      className,
    )}
    data-slot="item-description"
    {...props}
  />
);

const ItemActions = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div className={cn('flex items-center gap-2', className)} data-slot="item-actions" {...props} />
);

const ItemHeader = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn('flex basis-full items-center justify-between gap-2', className)}
    data-slot="item-header"
    {...props}
  />
);

const ItemFooter = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn('flex basis-full items-center justify-between gap-2', className)}
    data-slot="item-footer"
    {...props}
  />
);

export {
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  ItemHeader,
  ItemFooter,
};
