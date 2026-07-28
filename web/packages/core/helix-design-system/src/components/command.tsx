'use client';

import type * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@helix/design-system/components/dialog';
import { InputGroup, InputGroupAddon } from '@helix/design-system/components/input-group';
import { cn } from '@helix/design-system/lib/utils';
import { Command as CommandPrimitive } from 'cmdk';
import { SearchIcon, CheckIcon } from 'lucide-react';

const Command = ({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) => (
  <CommandPrimitive
    className={cn(
      'bg-popover text-popover-foreground flex size-full flex-col overflow-hidden rounded-md',
      className,
    )}
    data-slot="command"
    {...props}
  />
);

const CommandDialog = ({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
}) => (
  <Dialog {...props}>
    <DialogHeader className="sr-only">
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
    <DialogContent
      className={cn('top-1/3 translate-y-0 overflow-hidden rounded-md p-0', className)}
      showCloseButton={showCloseButton}
    >
      {children}
    </DialogContent>
  </Dialog>
);

const CommandInput = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) => (
  <div className="border-b pb-0" data-slot="command-input-wrapper">
    <InputGroup className="border-input/30 bg-input/30 h-8 border-none shadow-none! *:data-[slot=input-group-addon]:pl-2!">
      <CommandPrimitive.Input
        className={cn(
          'w-full text-xs outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        data-slot="command-input"
        {...props}
      />
      <InputGroupAddon>
        <SearchIcon className="size-4 shrink-0 opacity-50" />
      </InputGroupAddon>
    </InputGroup>
  </div>
);

const CommandList = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) => (
  <CommandPrimitive.List
    className={cn(
      'no-scrollbar max-h-72 scroll-py-0 overflow-x-hidden overflow-y-auto outline-none',
      className,
    )}
    data-slot="command-list"
    {...props}
  />
);

const CommandEmpty = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) => (
  <CommandPrimitive.Empty
    className={cn('py-6 text-center text-xs', className)}
    data-slot="command-empty"
    {...props}
  />
);

const CommandGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) => (
  <CommandPrimitive.Group
    className={cn(
      'text-foreground **:[[cmdk-group-heading]]:text-muted-foreground overflow-hidden **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs',
      className,
    )}
    data-slot="command-group"
    {...props}
  />
);

const CommandSeparator = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) => (
  <CommandPrimitive.Separator
    className={cn('bg-border -mx-1 h-px', className)}
    data-slot="command-separator"
    {...props}
  />
);

const CommandItem = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) => (
  <CommandPrimitive.Item
    className={cn(
      "group/command-item data-selected:bg-muted data-selected:text-foreground data-selected:*:[svg]:text-foreground relative flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-xs outline-hidden select-none in-data-[slot=dialog-content]:rounded-md! data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
    data-slot="command-item"
    {...props}
  >
    {children}
    <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
  </CommandPrimitive.Item>
);

const CommandShortcut = ({ className, ...props }: React.ComponentProps<'span'>) => (
  <span
    className={cn(
      'text-muted-foreground group-data-selected/command-item:text-foreground ml-auto text-xs tracking-widest',
      className,
    )}
    data-slot="command-shortcut"
    {...props}
  />
);

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
