import { createTRPCLinks } from '@helix/web-core/trpc/links';
import { createQueryClient as createSharedQueryClient } from '@helix/web-core/trpc/query-client';

import { env } from '@/lib/env';

import type { QueryClient } from '@tanstack/react-query';

const getBaseUrl = (): string => {
  if (typeof window !== 'undefined') {
    return '';
  }
  return env.NEXT_PUBLIC_BASE_URL;
};

export const createQueryClient = (): QueryClient => createSharedQueryClient();

export const links = createTRPCLinks({ baseUrl: getBaseUrl(), source: 'hardware-catalog' });
