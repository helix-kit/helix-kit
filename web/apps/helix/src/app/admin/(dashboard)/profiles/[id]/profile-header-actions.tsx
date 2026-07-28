'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@helix/design-system/components/button';
import { DeleteConfirmDialog } from '@helix/design-system/components/delete-confirm-dialog';
import { MutationModal } from '@helix/design-system/components/mutation-modal';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { useTRPCMutation } from '@/server/react';

const NAME_MAX = 200;
const DESCRIPTION_MAX = 500;

const editProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(NAME_MAX),
  description: z.string().max(DESCRIPTION_MAX),
});

export const ProfileHeaderActions = ({
  profile,
}: {
  profile: { id: string; name: string; description: string | null };
}) => {
  const router = useRouter();
  const update = useTRPCMutation((api) => api.profiles.update.mutationOptions());
  const remove = useTRPCMutation((api) =>
    api.profiles.delete.mutationOptions({
      onSuccess: () => {
        toast.success('Profile deleted');
        router.push('/admin/profiles');
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <div className="flex items-center gap-2">
      <MutationModal
        defaultValues={{ name: profile.name, description: profile.description ?? '' }}
        fields={[
          { name: 'name', label: 'Name', type: 'input' },
          { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional' },
        ]}
        mutation={{
          isPending: update.isPending,
          mutateAsync: (values) =>
            update.mutateAsync({
              id: profile.id,
              name: values.name,
              description: values.description === '' ? null : values.description,
            }),
        }}
        refresh={() => {
          router.refresh();
        }}
        schema={editProfileSchema}
        successToast={() => 'Profile updated'}
        titleText="Edit profile"
        trigger={
          <Button size="sm" variant="outline">
            <Pencil />
            Edit
          </Button>
        }
      />
      <DeleteConfirmDialog
        description={`This deletes "${profile.name}", its tracks, and its device assignments. This cannot be undone.`}
        isPending={remove.isPending}
        title="Delete profile?"
        trigger={
          <Button size="sm" variant="destructive">
            <Trash2 />
            Delete
          </Button>
        }
        onConfirm={() => {
          remove.mutate({ id: profile.id });
        }}
      />
    </div>
  );
};
