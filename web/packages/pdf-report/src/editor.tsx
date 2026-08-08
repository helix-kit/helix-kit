'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { CodeEditor } from '@helix/code-executor/editor';
import { JsonSchemaBuilder } from '@helix/json-schema/builder';
import { JsonEditor } from '@helix/json-schema/editor';

import { renderReportToBlob } from './browser';
import { fetchReportPdf } from './client';
import { defaultReportTemplate } from './defaults';
import { parseJson, prettyJson } from './json';
import { reportSpecJsonSchema } from './schema';

import type { ReportBranding, ReportTemplate } from './types';
import type { JSONSchema } from 'zod/v4/core';

type ParseState =
  { status: 'ready'; template: ReportTemplate } | { status: 'error'; error: string };

// A server render costs a round trip, so it is worth waiting longer to avoid
// firing one per keystroke. A client render is local and cheap enough to feel
// immediate, so it can afford to react sooner.
const DEBOUNCE_MS = { client: 250, server: 500 } as const;

const SPEC_PATH = 'helix-pdf-report-spec.json';
const INPUT_PATH = 'helix-pdf-report-input.json';

// Built once: the catalog is static, and Monaco keys its schemas by file match.
const specSchema = { fileMatch: SPEC_PATH, schema: reportSpecJsonSchema() };

type Pane = 'schema' | 'code' | 'spec' | 'input';

const PANES: { id: Pane; label: string }[] = [
  { id: 'schema', label: 'Input schema' },
  { id: 'code', label: 'Code' },
  { id: 'spec', label: 'Layout' },
  { id: 'input', label: 'Preview data' },
];

export type ReportTemplateEditorProps = {
  /** Starting template. The editor is uncontrolled — remount it (change `key`) to reset. */
  defaultValue?: ReportTemplate;
  /** Fires whenever every pane parses cleanly, so the host can drive a download button. */
  onChange?: (value: ReportTemplate) => void;
  /** Fires with the parse or render error, or null once it clears. */
  onError?: (error: string | null) => void;
  /** Render route the preview posts to; defaults to `/api/pdf-report`. */
  endpoint?: string;
  /**
   * Where the preview is rendered. `client` skips the round trip, which makes
   * editing feel immediate; `server` proves what a delivered document contains.
   * Both run the same pipeline.
   */
  renderMode?: 'client' | 'server';
  branding?: ReportBranding;
  theme?: 'light' | 'dark';
  previewDebounceMs?: number;
};

/**
 * Two-tier template authoring.
 *
 * Left: the four things a template is — the schema of its input, the code that
 * turns that into display values, the layout those values bind into, and sample
 * input to preview against. Right: the rendered PDF.
 *
 * The preview runs the whole pipeline, code step included, so what an author
 * sees is what a recipient gets rather than an approximation of it.
 */
export const ReportTemplateEditor = ({
  defaultValue = defaultReportTemplate,
  onChange,
  onError,
  endpoint,
  branding,
  renderMode = 'client',
  theme = 'light',
  previewDebounceMs,
}: ReportTemplateEditorProps) => {
  const [pane, setPane] = useState<Pane>('code');
  const [inputSchema, setInputSchema] = useState<JSONSchema._JSONSchema>(defaultValue.inputSchema);
  const [code, setCode] = useState(defaultValue.code);
  const [specDraft, setSpecDraft] = useState(() => prettyJson(defaultValue.spec));
  const [outputDraft, setOutputDraft] = useState(() => prettyJson(defaultValue.outputSchema));
  const [inputDraft, setInputDraft] = useState(() => prettyJson(defaultValue.demoInput));

  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const previewUrlRef = useRef<string | null>(null);
  const lastCommittedRef = useRef(JSON.stringify(defaultValue));

  const debounceMs = previewDebounceMs ?? DEBOUNCE_MS[renderMode];
  const monacoTheme: 'light' | 'vs-dark' = theme === 'dark' ? 'vs-dark' : 'light';

  const parseState = useMemo<ParseState>(() => {
    try {
      return {
        status: 'ready',
        template: {
          inputSchema,
          code,
          outputSchema: parseJson(outputDraft, 'Output schema') as JSONSchema._JSONSchema,
          spec: parseJson(specDraft, 'Layout JSON') as ReportTemplate['spec'],
          demoInput: parseJson(inputDraft, 'Preview data'),
        },
      };
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : 'Invalid JSON' };
    }
  }, [code, inputDraft, inputSchema, outputDraft, specDraft]);

  useEffect(() => {
    if (parseState.status === 'error') {
      onError?.(parseState.error);
      return;
    }

    onError?.(previewError);
    const serialized = JSON.stringify(parseState.template);
    if (serialized !== lastCommittedRef.current) {
      lastCommittedRef.current = serialized;
      onChange?.(parseState.template);
    }
  }, [onChange, onError, parseState, previewError]);

  useEffect(() => {
    if (parseState.status === 'error') {
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const render = async () => {
        try {
          setPreviewError(null);

          const blob =
            renderMode === 'client'
              ? await renderReportToBlob(parseState.template, { branding })
              : await fetchReportPdf({
                  template: parseState.template,
                  branding,
                  endpoint,
                  filename: 'helix-report-preview.pdf',
                  signal: controller.signal,
                });

          // A client render cannot be aborted mid-flight, so drop a result that
          // a newer edit has already superseded.
          if (controller.signal.aborted) {
            return;
          }

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

      void render();
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [branding, debounceMs, endpoint, parseState, renderMode]);

  useEffect(
    () => () => {
      if (previewUrlRef.current !== null) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    },
    [],
  );

  const message = parseState.status === 'error' ? parseState.error : previewError;

  let previewContent: React.ReactNode;
  if (message !== null) {
    previewContent = (
      <div className="text-destructive h-full overflow-auto px-6 py-4 font-mono text-xs whitespace-pre-wrap">
        {message}
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
        <div className="flex h-10 shrink-0 items-center gap-1 border-b px-1">
          {PANES.map((entry) => (
            <button
              key={entry.id}
              className={
                entry.id === pane
                  ? 'bg-muted text-foreground rounded px-3 py-1 text-xs font-medium'
                  : 'text-muted-foreground hover:text-foreground rounded px-3 py-1 text-xs'
              }
              type="button"
              onClick={() => {
                setPane(entry.id);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {pane === 'schema' ? (
            <div className="p-2">
              <p className="text-muted-foreground mb-2 px-1 text-xs">
                What the report is handed. This also types <code>input</code> in the code pane.
              </p>
              <JsonSchemaBuilder value={inputSchema} onValueChange={setInputSchema} />
            </div>
          ) : null}

          {pane === 'code' ? (
            <CodeEditor
              className="h-full"
              inputSchema={inputSchema}
              theme={monacoTheme}
              value={code}
              onChange={setCode}
            />
          ) : null}

          {pane === 'spec' ? (
            <JsonEditor
              className="h-full"
              path={SPEC_PATH}
              schema={specSchema}
              theme={monacoTheme}
              value={specDraft}
              onChange={setSpecDraft}
            />
          ) : null}

          {pane === 'input' ? (
            <JsonEditor
              className="h-full"
              path={INPUT_PATH}
              theme={monacoTheme}
              value={inputDraft}
              onChange={setInputDraft}
            />
          ) : null}
        </div>

        {pane === 'code' ? (
          <div className="shrink-0 border-t">
            <div className="text-muted-foreground px-3 py-1.5 text-xs font-medium tracking-[0.16em] uppercase">
              Output schema
            </div>
            {/* Monaco sizes to its container, so the height lives on the wrapper. */}
            <div className="h-[180px] border-t">
              <JsonEditor
                className="h-full"
                path="helix-pdf-report-output.json"
                theme={monacoTheme}
                value={outputDraft}
                onChange={setOutputDraft}
              />
            </div>
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
