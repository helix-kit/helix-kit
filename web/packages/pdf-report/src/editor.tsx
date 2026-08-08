'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchReportPdf } from './client';
import { defaultReportDocument } from './defaults';
import { parseJson, prettyJson } from './json';
import { JsonEditorPane } from './json-editor-pane';
import { reportSpecJsonSchema } from './schema';

import type { ReportBranding, ReportDocument } from './types';

type ParseState =
  { status: 'ready'; document: ReportDocument } | { status: 'error'; error: string };

const DEFAULT_PREVIEW_DEBOUNCE_MS = 400;

const TEMPLATE_PATH = 'helix-pdf-report-template.json';
const PREVIEW_DATA_PATH = 'helix-pdf-report-preview-data.json';

// Built once: the catalog is static, and Monaco keys its schemas by file match.
const templateSchema = { fileMatch: TEMPLATE_PATH, schema: reportSpecJsonSchema() };

export type ReportTemplateEditorProps = {
  /** Starting document. The editor is uncontrolled — remount it (change `key`) to reset. */
  defaultValue?: ReportDocument;
  /** Fires whenever both panes parse cleanly, so the host can drive a download button. */
  onChange?: (value: ReportDocument) => void;
  /** Fires with the parse error, or null once the drafts parse again. */
  onError?: (error: string | null) => void;
  /** Render route the preview posts to; defaults to `/api/pdf-report`. */
  endpoint?: string;
  branding?: ReportBranding;
  theme?: 'light' | 'dark';
  showDemoDataEditor?: boolean;
  previewDebounceMs?: number;
};

/**
 * Two-pane template authoring: the json-render spec (and optionally its demo
 * data) on the left, the server-rendered PDF on the right. The preview goes
 * through the same render route as a delivered report, so what an author sees is
 * what recipients receive.
 */
export const ReportTemplateEditor = ({
  defaultValue = defaultReportDocument,
  onChange,
  onError,
  endpoint,
  branding,
  theme = 'light',
  showDemoDataEditor = true,
  previewDebounceMs = DEFAULT_PREVIEW_DEBOUNCE_MS,
}: ReportTemplateEditorProps) => {
  const [specDraft, setSpecDraft] = useState(() => prettyJson(defaultValue.spec));
  const [demoDataDraft, setDemoDataDraft] = useState(() => prettyJson(defaultValue.demoData));
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDemoDataOpen, setIsDemoDataOpen] = useState(false);

  const previewUrlRef = useRef<string | null>(null);
  const lastCommittedRef = useRef(JSON.stringify(defaultValue));

  const monacoTheme: 'light' | 'vs-dark' = theme === 'dark' ? 'vs-dark' : 'light';

  const parseState = useMemo<ParseState>(() => {
    try {
      return {
        status: 'ready',
        document: {
          spec: parseJson(specDraft, 'Template JSON') as ReportDocument['spec'],
          demoData: parseJson(demoDataDraft, 'Demo data JSON') as Record<string, unknown>,
        },
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Invalid JSON',
      };
    }
  }, [demoDataDraft, specDraft]);

  useEffect(() => {
    if (parseState.status === 'error') {
      onError?.(parseState.error);
      return;
    }

    onError?.(null);
    const serialized = JSON.stringify(parseState.document);
    if (serialized !== lastCommittedRef.current) {
      lastCommittedRef.current = serialized;
      onChange?.(parseState.document);
    }
  }, [onChange, onError, parseState]);

  useEffect(() => {
    if (parseState.status === 'error') {
      return undefined;
    }

    const controller = new AbortController();

    const timer = setTimeout(() => {
      const renderPreview = async () => {
        try {
          setPreviewError(null);

          const blob = await fetchReportPdf({
            document: parseState.document,
            branding,
            endpoint,
            filename: 'helix-report-preview.pdf',
            signal: controller.signal,
          });
          const objectUrl = URL.createObjectURL(blob);

          if (previewUrlRef.current !== null) {
            URL.revokeObjectURL(previewUrlRef.current);
          }

          previewUrlRef.current = objectUrl;
          setPreviewUrl(objectUrl);
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          if (previewUrlRef.current !== null) {
            URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
          }

          setPreviewUrl(null);
          setPreviewError(error instanceof Error ? error.message : 'Failed to render the preview');
        }
      };

      void renderPreview();
    }, previewDebounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [branding, endpoint, parseState, previewDebounceMs]);

  useEffect(
    () => () => {
      if (previewUrlRef.current !== null) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    },
    [],
  );

  let previewContent: React.ReactNode;

  if (parseState.status === 'error') {
    previewContent = (
      <div className="text-destructive flex h-full items-center justify-center px-6 text-center text-sm">
        {parseState.error}
      </div>
    );
  } else if (previewError !== null) {
    previewContent = (
      <div className="text-destructive flex h-full items-center justify-center px-6 text-center text-sm">
        {previewError}
      </div>
    );
  } else if (previewUrl === null) {
    previewContent = (
      <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm">
        Rendering preview…
      </div>
    );
  } else {
    previewContent = <iframe className="h-full w-full" src={previewUrl} title="PDF preview" />;
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-2">
      <div className="bg-background flex h-full min-h-[26rem] min-w-0 flex-col overflow-hidden rounded-md border">
        <div className="flex h-10 shrink-0 items-center border-b px-3">
          <span className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
            Template JSON
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <JsonEditorPane
            className="h-full"
            path={TEMPLATE_PATH}
            schema={templateSchema}
            theme={monacoTheme}
            value={specDraft}
            onChange={setSpecDraft}
          />
        </div>

        {showDemoDataEditor ? (
          <div className="shrink-0 border-t">
            <button
              aria-expanded={isDemoDataOpen}
              className="hover:bg-muted/50 flex h-10 w-full items-center gap-2 px-3 text-left"
              type="button"
              onClick={() => {
                setIsDemoDataOpen((open) => !open);
              }}
            >
              <span className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
                Preview Data
              </span>
              <span className="text-muted-foreground/70 ml-auto text-xs">
                {isDemoDataOpen ? 'Hide' : 'Edit'}
              </span>
            </button>
            {/* Monaco sizes to 100% of its container, so the height lives on the
                wrapper rather than the editor's className. */}
            {isDemoDataOpen ? (
              <div className="h-[240px] border-t">
                <JsonEditorPane
                  className="h-full"
                  path={PREVIEW_DATA_PATH}
                  theme={monacoTheme}
                  value={demoDataDraft}
                  onChange={setDemoDataDraft}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="bg-background flex h-full min-h-[26rem] min-w-0 flex-col overflow-hidden rounded-md border">
        <div className="flex h-10 shrink-0 items-center border-b px-3">
          <span className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
            Preview
          </span>
        </div>
        <div className="min-h-0 flex-1">{previewContent}</div>
      </div>
    </div>
  );
};
