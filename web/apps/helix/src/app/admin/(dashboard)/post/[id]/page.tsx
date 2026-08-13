import { PostEditor } from '@helix-hq/blog/ui/admin';

const EditPostPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return <PostEditor postId={id} />;
};

export default EditPostPage;
