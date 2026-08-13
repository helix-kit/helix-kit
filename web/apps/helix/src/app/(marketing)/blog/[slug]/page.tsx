import { notFound } from 'next/navigation';

import { excerpt } from '@helix-hq/blog/seo';
import { compilePost } from '@helix-hq/blog/server/mdx';
import { PostArticle, PostBreadcrumb, PostUnavailable, RelatedPosts } from '@helix-hq/blog/ui';
import { logger } from '@helix-hq/logger';

import { Section } from '@/components/marketing/section';
import { blogMdxComponents, blogSeo } from '@/lib/blog';
import { publicOrigin, site } from '@/lib/site';
import { fetchQuery } from '@/server/server';

import type { Metadata } from 'next';

export const revalidate = 60;

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> => {
  const { slug } = await params;
  try {
    const post = await fetchQuery((trpc) => trpc.blogPublic.getBySlug.queryOptions({ slug }));
    if (post === null) return {};

    const description = post.description !== '' ? post.description : excerpt(post.content);
    const url = `/blog/${slug}`;
    const published =
      post.publishedAt !== null ? new Date(post.publishedAt).toISOString() : undefined;
    const modified = new Date(post.updatedAt).toISOString();
    const authors =
      post.authorName != null && post.authorName !== '' ? [post.authorName] : undefined;

    return {
      title: post.title,
      description,
      keywords: post.tags,
      authors: authors?.map((name) => ({ name })),
      alternates: { canonical: url },
      openGraph: {
        type: 'article',
        title: post.title,
        description,
        url,
        siteName: site.name,
        locale: 'en_US',
        publishedTime: published,
        modifiedTime: modified,
        authors,
        tags: post.tags,
        // og:image comes from the dynamic opengraph-image.tsx (1200x630, branded) — appended
        // by Next automatically. We intentionally do NOT use the raw cover here: covers are
        // full-res photos (multi-MB) that break WhatsApp's 500KB limit and mis-size previews.
      },
      twitter: {
        card: 'summary_large_image',
        title: post.title,
        description,
        site: site.twitter,
        creator: site.twitter,
      },
    };
  } catch {
    return {};
  }
};

const BlogPostPage = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params;

  const post = await fetchQuery((trpc) => trpc.blogPublic.getBySlug.queryOptions({ slug }));
  if (post === null) notFound();

  const related = await fetchQuery((trpc) =>
    trpc.blogPublic.getRelated.queryOptions({ slug, tags: post.tags, limit: 3 }),
  ).catch(() => []);

  // Blog content is authored MDX (compiled at request time), so a single malformed
  // post must degrade gracefully rather than 500 the whole route.
  let compiled: Awaited<ReturnType<typeof compilePost>> | null = null;
  try {
    compiled = await compilePost(post.content);
  } catch (error) {
    logger.error(`Failed to compile blog post "${slug}":`, error);
  }

  if (compiled === null) {
    return (
      <Section className="border-b-0">
        <PostBreadcrumb title={post.title} />
        <PostUnavailable title={post.title} />
      </Section>
    );
  }

  const description = post.description !== '' ? post.description : excerpt(post.content);
  const jsonLd = blogSeo.postJsonLd(post, {
    description,
    published: post.publishedAt !== null ? new Date(post.publishedAt).toISOString() : undefined,
    modified: new Date(post.updatedAt).toISOString(),
  });

  return (
    <Section className="border-b-0">
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        type="application/ld+json"
      />
      <PostBreadcrumb title={post.title} />

      <PostArticle
        body={compiled.body}
        components={blogMdxComponents}
        post={post}
        shareUrl={`${publicOrigin}/blog/${slug}`}
        toc={compiled.toc}
      />

      <RelatedPosts posts={related} />
    </Section>
  );
};

export default BlogPostPage;
