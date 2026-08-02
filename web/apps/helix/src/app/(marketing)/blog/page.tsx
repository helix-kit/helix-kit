import { PostGrid } from '@helix/blog/ui';

import { Section, SectionHeading } from '@/components/marketing/section';
import { blogSeo } from '@/lib/blog';
import { site } from '@/lib/site';
import { fetchQuery } from '@/server/server';

import type { Metadata } from 'next';

const BLOG_TITLE = 'Helix Blog';
const BLOG_DESCRIPTION = 'Product updates, deep dives, and release notes from the Helix project.';

export const metadata: Metadata = {
  title: 'Blog',
  description: BLOG_DESCRIPTION,
  alternates: {
    canonical: '/blog',
    types: { 'application/rss+xml': [{ url: '/blog/feed.xml', title: BLOG_TITLE }] },
  },
  openGraph: {
    type: 'website',
    title: BLOG_TITLE,
    description: BLOG_DESCRIPTION,
    url: '/blog',
    siteName: site.name,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: BLOG_TITLE,
    description: BLOG_DESCRIPTION,
    site: site.twitter,
    creator: site.twitter,
  },
};

export const revalidate = 60;

const BlogPage = async () => {
  const posts = await fetchQuery((trpc) =>
    trpc.blogPublic.listPublished.queryOptions({ limit: 24, offset: 0 }),
  ).catch(() => []);

  const jsonLd = blogSeo.blogJsonLd(posts, { name: BLOG_TITLE, description: BLOG_DESCRIPTION });

  return (
    <Section className="border-b-0">
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        type="application/ld+json"
      />
      <SectionHeading
        description="Product updates, engineering deep dives, and release notes."
        eyebrow="Blog"
        title="From the Helix project"
      />

      <PostGrid posts={posts} />
    </Section>
  );
};

export default BlogPage;
