import { PostCard } from '@/components/blog/post-card';
import { Section, SectionHeading } from '@/components/marketing/section';
import { fetchQuery } from '@/server/server';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Product updates, deep dives, and release notes from the Helix project.',
};

export const revalidate = 60;

const BlogPage = async () => {
  const posts = await fetchQuery((trpc) =>
    trpc.blogPublic.listPublished.queryOptions({ limit: 24, offset: 0 }),
  ).catch(() => []);

  return (
    <Section className="border-b-0">
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
