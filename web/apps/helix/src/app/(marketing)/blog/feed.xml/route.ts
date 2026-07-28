import { runtimeOrigin, site } from '@/lib/site';
import { api } from '@/server/caller';

export const dynamic = 'force-dynamic';

const FEED_DESCRIPTION = 'Product updates, deep dives, and release notes from the Helix project.';

const escapeXml = (value: string): string =>
  value.replace(
    /[<>&'"]/g,
    (char) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char,
  );

const loadItems = async (base: string): Promise<string> => {
  try {
    const posts = await api().listPublished({ limit: 50, offset: 0 });
    return posts
      .map((post) => {
        const url = `${base}/blog/${post.slug}`;
        const pubDate = post.publishedAt !== null ? new Date(post.publishedAt).toUTCString() : '';
        return [
          '    <item>',
          `      <title>${escapeXml(post.title)}</title>`,
          `      <link>${url}</link>`,
          `      <guid isPermaLink="true">${url}</guid>`,
          pubDate !== '' ? `      <pubDate>${pubDate}</pubDate>` : '',
          `      <description>${escapeXml(post.description)}</description>`,
          ...post.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
          '    </item>',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n');
  } catch {
    return '';
  }
};

export const GET = async (): Promise<Response> => {
  const base = runtimeOrigin();
  const items = await loadItems(base);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(site.name)} Blog</title>
    <link>${base}/blog</link>
    <atom:link href="${base}/blog/feed.xml" rel="self" type="application/rss+xml" />
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>en</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
    },
  });
};
