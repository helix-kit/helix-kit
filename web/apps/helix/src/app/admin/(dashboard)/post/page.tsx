import { createLoader, type SearchParams } from 'nuqs/server';

import { fetchQuery } from '@/server/server';

import { CreatePostButton } from './create-post-button';
import { PostsTable } from './posts-table';
import { postsSearchParsers } from './search-params';

const loadSearch = createLoader(postsSearchParsers);

const AdminHome = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const params = await loadSearch(searchParams);
  const { rows, pageCount } = await fetchQuery((trpc) => trpc.blog.list.queryOptions(params));

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 p-4 sm:p-6">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Posts</h1>
          <p className="text-muted-foreground text-sm">Create, edit, and publish blog posts.</p>
        </div>
        <CreatePostButton />
      </div>

      <PostsTable pageCount={pageCount} rows={rows} />
    </div>
  );
};

export default AdminHome;
