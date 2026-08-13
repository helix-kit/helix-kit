'use client';

import type { ComponentProps } from 'react';

import { TooltipProvider } from '@helix-hq/design-system/components/tooltip';
import { RootProvider } from 'fumadocs-ui/provider/next';

import { SearchDialog } from './search';

type GeistdocsProviderProps = ComponentProps<typeof RootProvider>;

export const GeistdocsProvider = ({ search, ...props }: GeistdocsProviderProps) => (
  <TooltipProvider>
    <RootProvider
      search={{
        SearchDialog,
        ...search,
      }}
      theme={{ enabled: false }}
      {...props}
    />
  </TooltipProvider>
);
