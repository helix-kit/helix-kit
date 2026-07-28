'use client';

import type * as React from 'react';

import { cn } from '@helix/design-system/lib/utils';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { Menubar as MenubarPrimitive } from 'radix-ui';

const Menubar = ({ className, ...props }: React.ComponentProps<typeof MenubarPrimitive.Root>) => (
  <MenubarPrimitive.Root
    className={cn('flex h-8 items-center gap-0.5 rounded-md border p-1', className)}
    data-slot="menubar"
    {...props}
  />
);

const MenubarMenu = ({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Menu>) => (
  <MenubarPrimitive.Menu data-slot="menubar-menu" {...props} />
);

const MenubarGroup = ({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Group>) => (
  <MenubarPrimitive.Group data-slot="menubar-group" {...props} />
);

const MenubarPortal = ({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Portal>) => (
  <MenubarPrimitive.Portal data-slot="menubar-portal" {...props} />
);

const MenubarRadioGroup = ({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioGroup>) => (
  <MenubarPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />
);

const MenubarTrigger = ({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Trigger>) => (
  <MenubarPrimitive.Trigger
    className={cn(
      'hover:bg-muted aria-expanded:bg-muted flex items-center rounded-md px-1.5 py-[calc(--spacing(0.8))] text-xs font-medium outline-hidden select-none',
      className,
    )}
    data-slot="menubar-trigger"
    {...props}
  />
);

const MenubarContent = ({
  className,
  align = 'start',
  alignOffset = -4,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Content>) => (
  <MenubarPortal>
    <MenubarPrimitive.Content
      align={align}
      alignOffset={alignOffset}
      className={cn(
        'text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 bg-popover/70 **:data-[slot$=-item]:focus:bg-foreground/10 **:data-[slot$=-item]:data-highlighted:bg-foreground/10 **:data-[slot$=-separator]:bg-foreground/5 **:data-[slot$=-trigger]:focus:bg-foreground/10 **:data-[slot$=-trigger]:aria-expanded:bg-foreground/10! **:data-[variant=destructive]:focus:bg-foreground/10! **:data-[variant=destructive]:text-accent-foreground! **:data-[variant=destructive]:**:text-accent-foreground! relative z-50 min-w-36 origin-(--radix-menubar-content-transform-origin) animate-none! overflow-hidden rounded-md shadow-md ring-1 duration-100 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150',
        className,
      )}
      data-slot="menubar-content"
      sideOffset={sideOffset}
      {...props}
    />
  </MenubarPortal>
);

const MenubarItem = ({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Item> & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}) => (
  <MenubarPrimitive.Item
    className={cn(
      "group/menubar-item focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:*:[svg]:text-destructive! relative flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-xs outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
    data-inset={inset}
    data-slot="menubar-item"
    data-variant={variant}
    {...props}
  />
);

const MenubarCheckboxItem = ({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.CheckboxItem> & {
  inset?: boolean;
}) => (
  <MenubarPrimitive.CheckboxItem
    checked={checked}
    className={cn(
      'focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-md py-2 pr-28 pl-8 text-xs outline-hidden select-none data-disabled:pointer-events-none data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0',
      className,
    )}
    data-inset={inset}
    data-slot="menubar-checkbox-item"
    {...props}
  >
    <span className="pointer-events-none absolute left-1.5 flex size-4 items-center justify-center [&_svg:not([class*='size-'])]:size-4">
      <MenubarPrimitive.ItemIndicator>
        <CheckIcon />
      </MenubarPrimitive.ItemIndicator>
    </span>
    {children}
  </MenubarPrimitive.CheckboxItem>
);

const MenubarRadioItem = ({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioItem> & {
  inset?: boolean;
}) => (
  <MenubarPrimitive.RadioItem
    className={cn(
      "focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-md py-2 pr-2 pl-8 text-xs outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
    data-inset={inset}
    data-slot="menubar-radio-item"
    {...props}
  >
    <span className="pointer-events-none absolute left-1.5 flex size-4 items-center justify-center [&_svg:not([class*='size-'])]:size-4">
      <MenubarPrimitive.ItemIndicator>
        <CheckIcon />
      </MenubarPrimitive.ItemIndicator>
    </span>
    {children}
  </MenubarPrimitive.RadioItem>
);

const MenubarLabel = ({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Label> & {
  inset?: boolean;
}) => (
  <MenubarPrimitive.Label
    className={cn('px-2 py-2 text-xs data-inset:pl-8', className)}
    data-inset={inset}
    data-slot="menubar-label"
    {...props}
  />
);

const MenubarSeparator = ({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Separator>) => (
  <MenubarPrimitive.Separator
    className={cn('bg-border -mx-1 my-1 h-px', className)}
    data-slot="menubar-separator"
    {...props}
  />
);

const MenubarShortcut = ({ className, ...props }: React.ComponentProps<'span'>) => (
  <span
    className={cn(
      'text-muted-foreground group-focus/menubar-item:text-accent-foreground ml-auto text-xs tracking-widest',
      className,
    )}
    data-slot="menubar-shortcut"
    {...props}
  />
);

const MenubarSub = ({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Sub>) => (
  <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />
);

const MenubarSubTrigger = ({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubTrigger> & {
  inset?: boolean;
}) => (
  <MenubarPrimitive.SubTrigger
    className={cn(
      "focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-xs outline-none select-none data-inset:pl-8 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
    data-inset={inset}
    data-slot="menubar-sub-trigger"
    {...props}
  >
    {children}
    <ChevronRightIcon className="ml-auto size-4" />
  </MenubarPrimitive.SubTrigger>
);

const MenubarSubContent = ({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubContent>) => (
  <MenubarPrimitive.SubContent
    className={cn(
      'text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 bg-popover/70 **:data-[slot$=-item]:focus:bg-foreground/10 **:data-[slot$=-item]:data-highlighted:bg-foreground/10 **:data-[slot$=-separator]:bg-foreground/5 **:data-[slot$=-trigger]:focus:bg-foreground/10 **:data-[slot$=-trigger]:aria-expanded:bg-foreground/10! **:data-[variant=destructive]:focus:bg-foreground/10! **:data-[variant=destructive]:text-accent-foreground! **:data-[variant=destructive]:**:text-accent-foreground! relative z-50 min-w-32 origin-(--radix-menubar-content-transform-origin) animate-none! overflow-hidden rounded-md shadow-lg ring-1 duration-100 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150',
      className,
    )}
    data-slot="menubar-sub-content"
    {...props}
  />
);

export {
  Menubar,
  MenubarPortal,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarGroup,
  MenubarSeparator,
  MenubarLabel,
  MenubarItem,
  MenubarShortcut,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
};
