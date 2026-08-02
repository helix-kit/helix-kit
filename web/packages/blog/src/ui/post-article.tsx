import Image from 'next/image';
import Link from 'next/link';

import { PostContent } from './post-content';
import { PostShare } from './post-share';
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

/**
 * The full rendered post: title block, cover, MDX body, and the two sticky rails — the discuss
 * links on the left, the table of contents on the right. Passing `shareUrl` (the post's canonical
 * absolute URL) enables the left rail.
 */
export const PostArticle = ({
  post,
  body,
  toc,
  components,
  shareUrl,
}: {
  post: PostArticleData;
  body: CompiledPost['body'];
  toc: TOCItemType[];
  components?: MDXComponents;
  shareUrl?: string;
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
    // One grid for the whole post so the title, body and both rails share a left edge. Only the
    // columns are placed; rows fall out of auto-placement, so a post with no cover leaves no hole.
    <article className="mx-auto mt-8 grid max-w-6xl gap-x-8 gap-y-10 lg:grid-cols-[3rem_minmax(0,44rem)_minmax(0,1fr)]">
      <header className="lg:col-start-2">
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
        <div className="border-border/60 relative aspect-[21/9] overflow-hidden rounded-xl border lg:col-start-2 lg:col-end-4">
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

      {shareUrl !== undefined ? (
        <div className="lg:col-start-1">
          <div className="sticky top-24">
            <PostShare title={post.title} url={shareUrl} />
          </div>
        </div>
      ) : null}
      <div className="min-w-0 lg:col-start-2">
        <PostContent body={body} components={components} />
      </div>
      <aside className="lg:col-start-3">
        <div className="sticky top-24">
          <TableOfContents toc={toc} />
        </div>
      </aside>
    </article>
  );
};
