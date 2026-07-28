import 'server-only';

import { cache } from 'react';

import { publicBlogApi } from './trpc';

// Server-side tRPC caller for the public marketing pages (RSC only). Read-only:
// every call runs with a public (user=null) context and returns published posts
// only — see publicBlogApi.
export const api = cache(() => publicBlogApi());
