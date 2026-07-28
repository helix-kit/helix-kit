'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@helix/design-system/components/button';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { useTRPCMutation } from '@/server/react';

export const CreatePostButton = () => {
  const router = useRouter();
  const create = useTRPCMutation((api) =>
    api.blog.create.mutationOptions({
      onSuccess: (post) => {
        if (post != null) router.push(`/admin/post/${post.id}`);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  return (
    <Button
      className="h-9"
      disabled={create.isPending}
      onClick={() => {
        create.mutate(undefined);
      }}
    >
      <Plus />
      New post
    </Button>
  );
};
