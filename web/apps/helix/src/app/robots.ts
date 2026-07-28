import { runtimeOrigin } from '@/lib/site';

import type { MetadataRoute } from 'next';

// Rendered per request so the origin comes from runtimeOrigin, not baked in at build time.
export const dynamic = 'force-dynamic';

const robots = (): MetadataRoute.Robots => {
  const base = runtimeOrigin();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api'] }],
    sitemap: `${base}/sitemap.xml`,
  };
};

export default robots;
