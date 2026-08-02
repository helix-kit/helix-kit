import { PostCard, type PostSummary } from './post-card';

/** Responsive card grid for a list of posts, with the empty state built in. */
export const PostGrid = ({
  posts,
  basePath = '/blog',
  emptyMessage = 'No posts published yet. Check back soon.',
  className = 'mt-12',
}: {
  posts: readonly PostSummary[];
  basePath?: string;
  emptyMessage?: string;
  className?: string;
}) => {
  if (posts.length === 0) {
    return (
      <div
        className={`border-border/70 bg-card/30 rounded-xl border border-dashed p-12 text-center ${className}`}
      >
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`grid gap-5 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {posts.map((post) => (
        <PostCard key={post.slug} basePath={basePath} post={post} />
      ))}
    </div>
  );
};

/** "Keep reading" rail shown under a post; renders nothing when there is nothing related. */
export const RelatedPosts = ({
  posts,
  basePath = '/blog',
  title = 'Keep reading',
}: {
  posts: readonly PostSummary[];
  basePath?: string;
  title?: string;
}) => {
  if (posts.length === 0) return null;
  return (
    <div className="border-border/60 mt-20 border-t pt-10">
      <h2 className="text-lg font-medium">{title}</h2>
      <PostGrid basePath={basePath} className="mt-6" posts={posts} />
    </div>
  );
};
