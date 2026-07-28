import { runtimeOrigin } from '@/lib/site';

import type { MetadataRoute } from 'next';

// Rendered per request so the origin comes from the appliance's PUBLIC_APP_URL
// rather than being baked in at build time — see runtimeOrigin.
export const dynamic = 'force-dynamic';

const robots = (): MetadataRoute.Robots => {
  const base = runtimeOrigin();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api'] }],
    sitemap: `${base}/sitemap.xml`,
  };
};

export default robots;
