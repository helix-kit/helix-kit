'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@helix/design-system/components/button';
import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { useBlogAdminApi } from './api';

export const CreatePostButton = ({ basePath = '/admin/post' }: { basePath?: string }) => {
  const router = useRouter();
  const api = useBlogAdminApi();
  const create = useMutation(
    api.create.mutationOptions({
      onSuccess: (post) => {
        if (post != null) router.push(`${basePath}/${post.id}`);
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
