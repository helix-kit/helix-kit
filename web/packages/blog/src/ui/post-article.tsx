import Image from 'next/image';
import Link from 'next/link';

import { PostContent } from './post-content';
import { TableOfContents } from './table-of-contents';

import type { CompiledPost } from '../server/mdx';
import type { TOCItemType } from 'fumadocs-core/toc';
import type { MDXComponents } from 'mdx/types';

export type PostArticleData = {
  title: string;
  tags: string[];
  coverImage: string;
  readingTime: number | null;
  publishedAt: string | Date | null;
  authorName: string | null;
};

export const PostBreadcrumb = ({
  title,
  basePath = '/blog',
  label = 'Blog',
}: {
  title: string;
  basePath?: string;
  label?: string;
}) => (
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
        <Link className="hover:text-foreground transition-colors" href={basePath}>
          {label}
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

/** Shown when a post's MDX fails to compile, so one bad post degrades instead of 500-ing the route. */
export const PostUnavailable = ({ title }: { title: string }) => (
  <article className="mx-auto mt-8 max-w-3xl">
    <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h1>
    <p className="text-muted-foreground mt-6">
      This post couldn’t be rendered right now. Please check back soon.
    </p>
  </article>
);

/** The full rendered post: title block, cover, MDX body, and a sticky table of contents. */
export const PostArticle = ({
  post,
  body,
  toc,
  components,
}: {
  post: PostArticleData;
  body: CompiledPost['body'];
  toc: TOCItemType[];
  components?: MDXComponents;
}) => {
  const isoPublished =
    post.publishedAt !== null ? new Date(post.publishedAt).toISOString() : undefined;
  const publishedLabel =
    post.publishedAt !== null
      ? new Date(post.publishedAt).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : '';

  return (
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
          <PostContent body={body} components={components} />
        </div>
        <aside className="lg:order-2">
          <div className="sticky top-24">
            <TableOfContents toc={toc} />
          </div>
        </aside>
      </div>
    </article>
  );
};
