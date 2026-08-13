import type { ComponentProps } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helix-hq/design-system/components/tabs';
import { cn } from '@helix-hq/design-system/lib/utils';

export const CodeBlockTabsList = (props: ComponentProps<typeof TabsList>) => (
  <TabsList
    {...props}
    className={cn(
      'bg-sidebar text-muted-foreground w-full rounded-none border-b px-2.5',
      props.className,
    )}
  >
    {props.children}
  </TabsList>
);

export const CodeBlockTabsTrigger = ({
  children,
  ...props
}: ComponentProps<typeof TabsTrigger>) => (
  <TabsTrigger
    {...props}
    className={cn(
      'group data-[state=active]:text-primary relative px-1 py-2 text-sm',
      props.className,
    )}
  >
    <div className="group-data-[state=active]:bg-primary absolute inset-x-0 bottom-0 h-px" />
    {children}
  </TabsTrigger>
);

export const CodeBlockTabs = (props: ComponentProps<typeof Tabs>) => (
  <Tabs
    {...props}
    className={cn('bg-background overflow-hidden rounded-sm border', props.className)}
  >
    {props.children}
  </Tabs>
);

export const CodeBlockTab = (props: ComponentProps<typeof TabsContent>) => (
  <TabsContent
    {...props}
    className={cn('[&_pre]:rounded-none [&_pre]:border-none [&>div]:mb-0', props.className)}
  />
);
