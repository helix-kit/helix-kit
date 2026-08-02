import { pillars, runtimeOrigin } from '@/lib/site';
import { fetchQuery } from '@/server/server';

import type { MetadataRoute } from 'next';

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
      const rows = await fetchQuery((api) => api.blogPublic.publishedSlugs.queryOptions());
      return rows.map((row) => ({
        url: `${base}/blog/${row.slug}`,
        lastModified: row.updatedAt,
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
