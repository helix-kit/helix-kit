import { pillars, runtimeOrigin } from '@/lib/site';
import { api } from '@/server/caller';

import type { MetadataRoute } from 'next';

// Rendered per request so the origin comes from the appliance's PUBLIC_APP_URL
// rather than being baked in at build time — see runtimeOrigin.
export const dynamic = 'force-dynamic';

const sitemap = async (): Promise<MetadataRoute.Sitemap> => {
  const base = runtimeOrigin();

  const staticRoutes = ['', '/product', '/open-source', '/docs', '/blog', '/legal'].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: 'weekly' as const,
    priority: path === '' ? 1 : 0.7,
  }));

  const pillarRoutes = pillars.map((p) => ({
    url: `${base}/product/${p.slug}`,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  const loadBlogRoutes = async (): Promise<MetadataRoute.Sitemap> => {
    try {
      const caller = await api();
      const slugs = await caller.publishedSlugs();
      return slugs.map((slug) => ({
        url: `${base}/blog/${slug}`,
        changeFrequency: 'monthly' as const,
        priority: 0.6,
      }));
    } catch {
      return [];
    }
  };

  return [...staticRoutes, ...pillarRoutes, ...(await loadBlogRoutes())];
};

export default sitemap;
