import Image from 'next/image';
import Link from 'next/link';

export type PostSummary = {
  slug: string;
  title: string;
  description: string;
  coverImage: string;
  tags: string[];
  readingTime: number | null;
  publishedAt: string | Date | null;
  authorName: string | null;
};

const formatDate = (value: string | Date | null): string => {
  if (value === null) return '';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export const PostCard = ({ post }: { post: PostSummary }) => (
  <Link
    className="group border-border/70 bg-card/40 hover:border-brand/50 hover:bg-card flex flex-col overflow-hidden rounded-xl border transition-colors"
    href={`/blog/${post.slug}`}
  >
    <div className="bg-muted relative aspect-[16/9] overflow-hidden">
      {post.coverImage !== '' ? (
        <Image
          alt={post.title}
          className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          src={post.coverImage}
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,var(--color-brand),transparent_60%)] opacity-20" />
      )}
    </div>
    <div className="flex flex-1 flex-col gap-2 p-5">
      <div className="flex flex-wrap gap-1.5">
        {post.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="border-border/60 bg-muted/40 text-muted-foreground rounded-full border px-2 py-0.5 text-xs"
          >
            {tag}
          </span>
        ))}
      </div>
      <h3 className="text-foreground text-base font-medium">{post.title}</h3>
      <p className="text-muted-foreground line-clamp-2 text-sm">{post.description}</p>
      <div className="text-muted-foreground mt-auto flex items-center gap-2 pt-2 text-xs">
        <span>{formatDate(post.publishedAt)}</span>
        {post.readingTime !== null ? (
          <>
            <span>·</span>
            <span>{post.readingTime} min read</span>
          </>
        ) : null}
      </div>
    </div>
  </Link>
);
