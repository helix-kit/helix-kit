import 'server-only';

import { cache } from 'react';

import { blogPublicRouter, type BlogContext } from '@helix/backend/blog';
import { createTRPCForContext } from '@helix/backend/trpc';

import { db } from './db';

// Server-side tRPC caller for the public marketing pages (RSC only): public (user=null) context, so it only sees published posts.
const t = createTRPCForContext<BlogContext>();
const createBlogPublicCaller = t.createCallerFactory(blogPublicRouter(t));

export const api = cache(() =>
  createBlogPublicCaller({
    db,
    user: null,
    adminRoles: [],
  }),
);
