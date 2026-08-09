'use client';

import { useCallback, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@helix/design-system/components/button';
import { useTheme } from '@helix/design-system/components/theme-provider';
import { fetchReportPdf, type ReportTemplate } from '@helix/pdf-report';
import { ReportTemplateEditor } from '@helix/pdf-report/editor';
import { Check, Download, Loader2, MessagesSquare, Plus, Trash2 } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';

import { useTRPCMutation, useTRPCQuery } from '@/server/react';
import type { AppRouter } from '@/server/trpc';

import { GeneratePrompt } from './generate-prompt';

import type { inferRouterOutputs } from '@trpc/server';

type Outputs = inferRouterOutputs<AppRouter>;
type TemplateRow = Outputs['reportTemplates']['get'];
type Conversations = Outputs['reportConversations']['list'];

const DOWNLOAD_FILENAME = 'helix-report.pdf';
const OBJECT_URL_REVOKE_DELAY_MS = 60_000;
/** Long enough that typing does not write per keystroke, short enough to feel automatic. */
const SAVE_DEBOUNCE_MS = 800;

const toTemplate = (row: TemplateRow): ReportTemplate => ({
  inputSchema: row.inputSchema as ReportTemplate['inputSchema'],
  code: row.code,
  outputSchema: row.outputSchema as ReportTemplate['outputSchema'],
  spec: row.spec as ReportTemplate['spec'],
  demoInput: row.demoInput,
});

const TemplateWorkspace = ({
  template: row,
  conversations,
  fixturesAvailable = false,
}: {
  template: TemplateRow;
  conversations: Conversations;
  fixturesAvailable?: boolean;
}) => {
  const { resolvedTheme } = useTheme();
  const router = useRouter();

  const [editorKey, setEditorKey] = useState(0);
  const [editorDocument, setEditorDocument] = useState<ReportTemplate>(() => toTemplate(row));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(conversations[0]?.id ?? null);

  const documentRef = useRef<ReportTemplate>(toTemplate(row));

  // The thread being read, so returning to a chat shows what was said in it.
  // Client-side because it changes with the selection, not with a navigation.
  const thread = useTRPCQuery((api) => ({
    ...api.reportConversations.get.queryOptions({ id: conversationId ?? '' }),
    enabled: conversationId !== null,
  }));

  const save = useTRPCMutation((api) =>
    api.reportTemplates.update.mutationOptions({
      onError: (mutationError) => {
        setError(mutationError.message);
      },
      onSettled: () => {
        setSaving(false);
      },
    }),
  );

  // Debounced, and sent as a whole template rather than a diff: the editor emits
  // a complete document on every change, and reconstructing which pane moved
  // would be guesswork the server would have to trust anyway.
  const persist = useDebouncedCallback((next: ReportTemplate) => {
    setSaving(true);
    setError(null);
    save.mutate({ id: row.id, ...next });
  }, SAVE_DEBOUNCE_MS);

  const handleChange = useCallback(
    (next: ReportTemplate) => {
      documentRef.current = next;
      persist(next);
    },
    [persist],
  );

  const currentDocument = useCallback(() => documentRef.current, []);

  // Generated parts arrive one at a time; each is a change like any other.
  const applyArtifact = useCallback(
    (patch: Partial<ReportTemplate>) => {
      const next = { ...documentRef.current, ...patch };
      documentRef.current = next;
      setEditorDocument(next);
      setEditorKey((key) => key + 1);
      persist(next);
    },
    [persist],
  );

  const startConversation = useTRPCMutation((api) =>
    api.reportConversations.create.mutationOptions({
      onSuccess: (created) => {
        setConversationId(created.id);
        router.refresh();
      },
    }),
  );

  const removeConversation = useTRPCMutation((api) =>
    api.reportConversations.remove.mutationOptions({
      onSuccess: (removed) => {
        setConversationId((current) => (current === removed.id ? null : current));
        router.refresh();
      },
    }),
  );

  const download = async () => {
    try {
      const blob = await fetchReportPdf({
        template: documentRef.current,
        filename: DOWNLOAD_FILENAME,
      });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = DOWNLOAD_FILENAME;
      anchor.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, OBJECT_URL_REVOKE_DELAY_MS);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Failed to render the PDF');
    }
  };

  return (
    <div className="flex h-[calc(100svh-6rem)] min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{row.name}</h1>
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            {saving ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Check className="size-3 text-emerald-500" />
                Saved
              </>
            )}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void download()}>
          <Download />
          Download PDF
        </Button>
      </div>

      {error === null ? null : (
        <div className="text-destructive border-destructive/30 bg-destructive/5 shrink-0 rounded-md border px-3 py-2 font-mono text-xs">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto rounded-md border p-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-muted-foreground flex items-center gap-1 text-xs font-medium">
              <MessagesSquare className="size-3" />
              Chats
            </span>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                startConversation.mutate({ subjectId: row.id });
              }}
            >
              <Plus className="size-3" />
              <span className="sr-only">New chat</span>
            </Button>
          </div>

          {conversations.length === 0 ? (
            <p className="text-muted-foreground px-1 text-xs">
              No chats yet. Start one to change this template by describing what you want.
            </p>
          ) : (
            conversations.map((entry) => (
              <div
                key={entry.id}
                className={`group flex items-center gap-1 rounded px-2 py-1 text-xs ${
                  entry.id === conversationId ? 'bg-muted font-medium' : 'hover:bg-muted/50'
                }`}
              >
                <button
                  className="min-w-0 flex-1 truncate text-left"
                  type="button"
                  onClick={() => {
                    setConversationId(entry.id);
                  }}
                >
                  {entry.title === '' ? 'Untitled chat' : entry.title}
                </button>
                <Button
                  className="opacity-0 group-hover:opacity-100"
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    removeConversation.mutate({ id: entry.id });
                  }}
                >
                  <Trash2 className="size-3" />
                  <span className="sr-only">Delete chat</span>
                </Button>
              </div>
            ))
          )}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          <GeneratePrompt
            conversationId={conversationId}
            currentDocument={currentDocument}
            fixturesAvailable={fixturesAvailable}
            initialMessages={thread.data?.messages}
            templateId={row.id}
            onArtifact={applyArtifact}
            onConversationStarted={(id) => {
              setConversationId(id);
              router.refresh();
            }}
          />
          <div className="min-h-0 flex-1">
            <ReportTemplateEditor
              key={editorKey}
              defaultValue={editorDocument}
              theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
              onChange={handleChange}
              onError={setError}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default TemplateWorkspace;
