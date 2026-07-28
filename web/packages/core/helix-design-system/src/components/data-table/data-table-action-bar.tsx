'use client';

import * as React from 'react';

import { Loader, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import * as ReactDOM from 'react-dom';

import type { Table } from '@tanstack/react-table';

import { cn } from '../../lib/utils';
import { Button } from '../button';
import { Separator } from '../separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';

interface DataTableActionBarProps<TData> extends React.ComponentProps<typeof motion.div> {
  table: Table<TData>;
  visible?: boolean;
  portalContainer?: Element | DocumentFragment | null;
}

/**
 * Floating bulk-action toolbar for selected rows.
 *
 * By default it becomes visible when the table has filtered selected rows and
 * portals into `document.body` after mount.
 */
const DataTableActionBar = <TData,>({
  table,
  visible: visibleProp,
  portalContainer: portalContainerProp,
  children,
  className,
  ...props
}: DataTableActionBarProps<TData>) => {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        table.toggleAllRowsSelected(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [table]);

  const portalContainer =
    portalContainerProp ?? (typeof document !== 'undefined' ? document.body : null);

  if (portalContainer === null) {
    return null;
  }

  const visible = visibleProp ?? table.getFilteredSelectedRowModel().rows.length > 0;

  return ReactDOM.createPortal(
    <AnimatePresence>
      {visible ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          aria-orientation="horizontal"
          className={cn(
            'bg-background text-foreground fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit flex-wrap items-center justify-center gap-2 rounded-md border p-2 shadow-sm',
            className,
          )}
          exit={{ opacity: 0, y: 20 }}
          initial={{ opacity: 0, y: 20 }}
          role="toolbar"
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          {...props}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    portalContainer,
  );
};

interface DataTableActionBarActionProps extends React.ComponentProps<typeof Button> {
  tooltip?: string;
  isPending?: boolean;
}

/**
 * Standard action-bar button with optional tooltip and pending-state spinner.
 */
const DataTableActionBarAction = ({
  size = 'sm',
  tooltip,
  isPending,
  disabled,
  className,
  children,
  ...props
}: DataTableActionBarActionProps) => {
  const trigger = (
    <Button
      className={cn(
        'border-secondary bg-secondary/50 hover:bg-secondary/70 gap-1.5 border [&>svg]:size-3.5',
        size === 'icon' ? 'size-7' : 'h-7',
        className,
      )}
      disabled={disabled ?? isPending}
      size={size}
      variant="secondary"
      {...props}
    >
      {isPending === true ? <Loader className="animate-spin" /> : children}
    </Button>
  );

  if (tooltip === undefined) {
    return trigger;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent
        className="bg-accent text-foreground border font-semibold dark:bg-zinc-900 [&>span]:hidden"
        sideOffset={6}
      >
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
};

interface DataTableActionBarSelectionProps<TData> {
  table: Table<TData>;
}

/**
 * Selection summary pill with an Escape-key discoverable clear-selection affordance.
 */
const DataTableActionBarSelection = <TData,>({
  table,
}: DataTableActionBarSelectionProps<TData>) => {
  const onClearSelection = React.useCallback(() => {
    table.toggleAllRowsSelected(false);
  }, [table]);

  return (
    <div className="flex h-7 items-center rounded-md border pr-1 pl-2.5">
      <span className="text-xs whitespace-nowrap">
        {table.getFilteredSelectedRowModel().rows.length} selected
      </span>
      <Separator className="mr-1 ml-2 data-[orientation=vertical]:h-4" orientation="vertical" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button className="size-5" size="icon" variant="ghost" onClick={onClearSelection}>
            <X className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          className="bg-accent text-foreground flex items-center gap-2 border px-2 py-1 font-semibold dark:bg-zinc-900 [&>span]:hidden"
          sideOffset={10}
        >
          <p>Clear selection</p>
          <kbd className="bg-background text-foreground rounded border px-1.5 py-px font-mono text-[0.7rem] font-normal shadow-xs select-none">
            <abbr className="no-underline" title="Escape">
              Esc
            </abbr>
          </kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
};

export { DataTableActionBar, DataTableActionBarAction, DataTableActionBarSelection };
