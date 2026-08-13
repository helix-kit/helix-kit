'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { Button } from '@helix-hq/design-system/components/button';
import { DeleteConfirmDialog } from '@helix-hq/design-system/components/delete-confirm-dialog';
import { Input } from '@helix-hq/design-system/components/input';
import { Label } from '@helix-hq/design-system/components/label';
import { Switch } from '@helix-hq/design-system/components/switch';
import { Textarea } from '@helix-hq/design-system/components/textarea';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useDebouncedCallback } from 'use-debounce';

import { useBlogAdminApi } from './api';

import type { MDXEditorMethods } from '@mdxeditor/editor';

// MDXEditor touches `document` on import, so it can only load in the browser.
const Editor = dynamic(() => import('../editor/mdx-editor'), { ssr: false });

const SAVE_DEBOUNCE_MS = 700;

type FormState = {
  title: string;
  slug: string;
  description: string;
  coverImage: string;
  tags: string;
  keywords: string;
  published: boolean;
};

export type PostEditorProps = {
  /** Id of the post being edited; the host route resolves it from its own params. */
  postId: string;
  /** Where the post list lives, navigated to after a delete. */
  listPath?: string;
  /** Where the "Back" control goes. */
  backPath?: string;
  /** Endpoint that accepts a `file` multipart upload and returns `{ url }`. */
  uploadEndpoint?: string;
};

export const PostEditor = ({
  postId: id,
  listPath = '/admin/post',
  backPath = '/admin',
  uploadEndpoint = '/api/upload',
}: PostEditorProps) => {
  const router = useRouter();

  const editorRef = useRef<MDXEditorMethods>(null);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState<FormState | null>(null);

  const api = useBlogAdminApi();
  const query = useQuery(api.getById.queryOptions({ id }, { refetchOnMount: false }));
  const update = useMutation(api.update.mutationOptions());
  const remove = useMutation(
    api.delete.mutationOptions({
      onSuccess: () => {
        router.push(listPath);
        router.refresh();
      },
    }),
  );

  useEffect(() => {
    if (query.data != null && form === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed editable form once the async post loads
      setForm({
        title: query.data.title,
        slug: query.data.slug,
        description: query.data.description,
        coverImage: query.data.coverImage,
        tags: query.data.tags.join(', '),
        keywords: query.data.keywords.join(', '),
        published: query.data.published,
      });
    }
  }, [query.data, form]);

  const toList = (value: string): string[] =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const save = useDebouncedCallback(async (next: FormState) => {
    setStatus('Saving…');
    try {
      await update.mutateAsync({
        id,
        data: {
          title: next.title,
          slug: next.slug === '' ? undefined : next.slug,
          description: next.description,
          coverImage: next.coverImage,
          tags: toList(next.tags),
          keywords: toList(next.keywords),
          published: next.published,
          content: editorRef.current?.getMarkdown() ?? '',
        },
      });
      setStatus('Saved');
    } catch (error) {
      setStatus('');
      toast.error(error instanceof Error ? error.message : 'Save failed');
    }
  }, SAVE_DEBOUNCE_MS);

  const patch = useCallback(
    (partial: Partial<FormState>) => {
      setForm((prev) => {
        if (prev === null) return prev;
        const next = { ...prev, ...partial };
        void save(next);
        return next;
      });
    },
    [save],
  );

  const onCoverUpload = async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch(uploadEndpoint, { method: 'POST', body });
    if (!res.ok) {
      toast.error('Cover upload failed');
      return;
    }
    const { url } = (await res.json()) as { url: string };
    patch({ coverImage: url });
  };

  if (query.isLoading || form === null) {
    return <div className="text-muted-foreground py-16 text-center text-sm">Loading…</div>;
  }
  if (query.data == null) {
    return <div className="text-muted-foreground py-16 text-center text-sm">Post not found.</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid gap-6 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              router.push(backPath);
            }}
          >
            <ArrowLeft />
            Back
          </Button>
          <span className="text-muted-foreground text-xs">{status}</span>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-sm" htmlFor="published">
                Published
              </Label>
              <Switch
                checked={form.published}
                id="published"
                onCheckedChange={(v) => {
                  patch({ published: v });
                }}
              />
            </div>
            <DeleteConfirmDialog
              description="This permanently deletes the post. This cannot be undone."
              isPending={remove.isPending}
              title="Delete post?"
              trigger={
                <Button size="sm" variant="destructive">
                  <Trash2 />
                  Delete
                </Button>
              }
              onConfirm={() => {
                remove.mutate({ id });
              }}
            />
          </div>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Post title"
              value={form.title}
              onChange={(e) => {
                patch({ title: e.target.value });
              }}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                value={form.slug}
                onChange={(e) => {
                  patch({ slug: e.target.value });
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input
                id="tags"
                value={form.tags}
                onChange={(e) => {
                  patch({ tags: e.target.value });
                }}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              className="h-20"
              id="description"
              value={form.description}
              onChange={(e) => {
                patch({ description: e.target.value });
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Cover image</Label>
            <div className="flex items-center gap-3">
              {form.coverImage !== '' ? (
                <div className="border-border/60 relative h-16 w-28 overflow-hidden rounded-md border">
                  <Image alt="Cover" className="object-cover" fill src={form.coverImage} />
                </div>
              ) : null}
              <label className="border-border/70 text-muted-foreground hover:bg-muted/40 inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                <Upload className="size-4" />
                Upload
                <input
                  accept="image/*"
                  className="hidden"
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file != null) void onCoverUpload(file);
                  }}
                />
              </label>
            </div>
          </div>
        </div>

        <Editor
          ref={editorRef}
          markdown={query.data.content}
          onChange={() => {
            setForm((prev) => {
              if (prev !== null) void save(prev);
              return prev;
            });
          }}
        />
      </div>
    </div>
  );
};
