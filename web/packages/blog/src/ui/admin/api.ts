'use client';

import { useFeatureApi } from '@helix/web-core/trpc/feature';

import type { BlogAdminRouter } from '../../server/router';

import { BLOG_ADMIN_ROUTER_KEY } from '../../mount';

/** The blog admin router, resolved out of the host's root router by its agreed mount key. */
export const useBlogAdminApi = () => useFeatureApi<BlogAdminRouter>(BLOG_ADMIN_ROUTER_KEY);
