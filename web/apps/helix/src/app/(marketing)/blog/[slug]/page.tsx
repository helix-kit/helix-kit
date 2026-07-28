import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { logger } from '@helix/logger';

import { PostCard } from '@/components/blog/post-card';
import { PostContent } from '@/components/blog/post-content';
import { TableOfContents } from '@/components/blog/table-of-contents';
import { Section } from '@/components/marketing/section';
import { compilePost } from '@/lib/blog-mdx';
import { excerpt, postJsonLd } from '@/lib/blog-seo';
import { site } from '@/lib/site';
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
        publishedTime: published,
        modifiedTime: modified,
        authors,
        tags: post.tags,
        // The dynamic opengraph-image.tsx is appended automatically; a cover image (if any) takes precedence.
        ...(post.coverImage !== '' ? { images: [{ url: post.coverImage }] } : {}),
      },
      twitter: { card: 'summary_large_image', title: post.title, description },
    };
  } catch {
    return {};
  }
};

const Breadcrumb = ({ title }: { title: string }) => (
  <nav aria-label="Breadcrumb">
    <ol className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
      <li>
        <Link className="hover:text-foreground transition-colors" href="/">
          Home
        </Link>
      </li>
      <li aria-hidden className="text-muted-foreground/40">
        /
      </li>
      <li>
        <Link className="hover:text-foreground transition-colors" href="/blog">
          Blog
        </Link>
      </li>
      <li aria-hidden className="text-muted-foreground/40">
        /
      </li>
      <li aria-current="page" className="text-foreground/70 max-w-[18rem] truncate">
        {title}
      </li>
    </ol>
  </nav>
);

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
        <Breadcrumb title={post.title} />
        <article className="mx-auto mt-8 max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {post.title}
          </h1>
          <p className="text-muted-foreground mt-6">
            This post couldn’t be rendered right now. Please check back soon.
          </p>
        </article>
      </Section>
    );
  }

  const { body, toc } = compiled;
  const description = post.description !== '' ? post.description : excerpt(post.content);
  const isoPublished =
    post.publishedAt !== null ? new Date(post.publishedAt).toISOString() : undefined;
  const isoModified = new Date(post.updatedAt).toISOString();
  const jsonLd = postJsonLd(post, {
    description,
    published: isoPublished,
    modified: isoModified,
  });
  const publishedLabel =
    post.publishedAt !== null
      ? new Date(post.publishedAt).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : '';

  return (
    <Section className="border-b-0">
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        type="application/ld+json"
      />
      <Breadcrumb title={post.title} />

      <article className="mt-8">
        <header className="mx-auto max-w-3xl">
          <div className="flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="border-border/60 bg-muted/40 text-muted-foreground rounded-full border px-2 py-0.5 text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {post.title}
          </h1>
          <div className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
            {post.authorName != null && post.authorName !== '' ? (
              <span>{post.authorName}</span>
            ) : null}
            {publishedLabel !== '' ? (
              <>
                <span>·</span>
                <time dateTime={isoPublished}>{publishedLabel}</time>
              </>
            ) : null}
            {post.readingTime !== null ? (
              <>
                <span>·</span>
                <span>{post.readingTime} min read</span>
              </>
            ) : null}
          </div>
        </header>

        {post.coverImage !== '' ? (
          <div className="border-border/60 relative mx-auto mt-8 aspect-[21/9] max-w-4xl overflow-hidden rounded-xl border">
            <Image
              alt={post.title}
              className="object-cover"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 1024px"
              src={post.coverImage}
            />
          </div>
        ) : null}

        <div className="mx-auto mt-10 grid max-w-5xl gap-10 lg:grid-cols-[1fr_16rem]">
          <div className="min-w-0 lg:order-1">
            <PostContent body={body} />
          </div>
          <aside className="lg:order-2">
            <div className="sticky top-24">
              <TableOfContents toc={toc} />
            </div>
          </aside>
        </div>
      </article>

      {related.length > 0 ? (
        <div className="border-border/60 mt-20 border-t pt-10">
          <h2 className="text-lg font-medium">Keep reading</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => (
              <PostCard key={r.slug} post={r} />
            ))}
          </div>
        </div>
      ) : null}
    </Section>
  );
};

export default BlogPostPage;
