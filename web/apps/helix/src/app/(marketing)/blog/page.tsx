import { PostCard } from '@/components/blog/post-card';
import { Section, SectionHeading } from '@/components/marketing/section';
import { absoluteUrl } from '@/lib/blog-seo';
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

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: BLOG_TITLE,
    description: BLOG_DESCRIPTION,
    url: absoluteUrl('/blog'),
    blogPost: posts.map((post) => ({
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      url: absoluteUrl(`/blog/${post.slug}`),
      ...(post.publishedAt !== null
        ? { datePublished: new Date(post.publishedAt).toISOString() }
        : {}),
    })),
  };

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

      {posts.length === 0 ? (
        <div className="border-border/70 bg-card/30 mt-12 rounded-xl border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm">No posts published yet. Check back soon.</p>
        </div>
      ) : (
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </Section>
  );
};

export default BlogPage;
