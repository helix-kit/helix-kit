import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft } from 'lucide-react';

import { PostCard } from '@/components/blog/post-card';
import { PostContent } from '@/components/blog/post-content';
import { TableOfContents } from '@/components/blog/table-of-contents';
import { Section } from '@/components/marketing/section';
import { compilePost } from '@/lib/blog-mdx';
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
    return {
      title: post.title,
      description: post.description,
      openGraph: post.coverImage !== '' ? { images: [post.coverImage] } : undefined,
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

  const { body, toc } = await compilePost(post.content);
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
      <Link
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        href="/blog"
      >
        <ArrowLeft className="size-4" />
        All posts
      </Link>

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
                <span>{publishedLabel}</span>
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
