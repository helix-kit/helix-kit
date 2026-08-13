'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { CodeEditor } from '@helix-hq/code-executor/editor';
import { JsonEditor, SchemaEditor } from '@helix-hq/json-schema/editor';

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
const INPUT_DATA_PATH = 'helix-pdf-report-input-data.json';
const INPUT_SCHEMA_PATH = 'helix-pdf-report-input-schema.json';
const OUTPUT_SCHEMA_PATH = 'helix-pdf-report-output-schema.json';

// Built once: the catalog is static, and Monaco keys its schemas by file match.
const specSchema = { fileMatch: SPEC_PATH, schema: reportSpecJsonSchema() };

type Pane = 'input' | 'code' | 'output' | 'layout' | 'data';

/**
 * Ordered as the data flows: what comes in, what transforms it, what comes out,
 * how that is drawn — and the sample used to preview the whole thing.
 */
const PANES: { id: Pane; label: string; hint: string }[] = [
  { id: 'input', label: 'Input', hint: 'What the report is handed. Types `input` in the code.' },
  { id: 'code', label: 'Code', hint: 'Turns the input into the values below.' },
  { id: 'output', label: 'Output', hint: 'What the code returns. The layout binds to this.' },
  { id: 'layout', label: 'Layout', hint: 'Where those values are drawn on the page.' },
  { id: 'data', label: 'Preview data', hint: 'Sample input, for the preview on the right.' },
];

export type ReportTemplateEditorProps = {
  /** The template to show. The panes follow it, so a new value replaces them. */
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
  const [outputSchema, setOutputSchema] = useState<JSONSchema._JSONSchema>(
    defaultValue.outputSchema,
  );
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
          outputSchema,
          spec: parseJson(specDraft, 'Layout JSON') as ReportTemplate['spec'],
          demoInput: parseJson(inputDraft, 'Preview data'),
        },
      };
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : 'Invalid JSON' };
    }
  }, [code, inputDraft, inputSchema, outputSchema, specDraft]);

  // Generated parts land in the panes without remounting the editor. The panes
  // are controlled, so remounting was never needed to show them — and it threw
  // away the rendered preview each time, blanking the pane on every artifact of
  // a generation.
  //
  // Adjusted during render rather than in an effect: an effect would paint the
  // previous template first and correct it immediately after, which is the same
  // flicker in a smaller form.
  const [seeded, setSeeded] = useState(defaultValue);
  if (seeded !== defaultValue) {
    setSeeded(defaultValue);
    setInputSchema(defaultValue.inputSchema);
    setCode(defaultValue.code);
    setOutputSchema(defaultValue.outputSchema);
    setSpecDraft(prettyJson(defaultValue.spec));
    setInputDraft(prettyJson(defaultValue.demoInput));
  }

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
          // Cleared here rather than before the attempt. Clearing it up front
          // makes the error vanish and come back on every edit, and during a
          // generation the edits arrive continuously — so a single broken state
          // reads as flashing rather than as one problem.
          setPreviewError(null);
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          // The last good render is kept. Replacing it with the error means the
          // pane alternates between a document and a message for as long as the
          // model takes to fix itself, and neither is readable while it does.
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
  if (previewUrl !== null) {
    // The document stays on screen while something is wrong with the next
    // version of it, with the problem stated above it. Swapping the document out
    // for the message loses the only thing that shows what the message is about.
    previewContent = (
      <div className="flex h-full flex-col">
        {message === null ? null : (
          <div className="text-destructive border-destructive/30 bg-destructive/5 max-h-32 shrink-0 overflow-auto border-b px-4 py-2 font-mono text-xs whitespace-pre-wrap">
            {message}
          </div>
        )}
        <iframe
          className={`w-full flex-1 ${message === null ? '' : 'opacity-60'}`}
          src={previewUrl}
          title="PDF preview"
        />
      </div>
    );
  } else if (message !== null) {
    previewContent = (
      <div className="text-destructive h-full overflow-auto px-6 py-4 font-mono text-xs whitespace-pre-wrap">
        {message}
      </div>
    );
  } else {
    previewContent = (
      <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm">
        Rendering preview…
      </div>
    );
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

        <p className="text-muted-foreground shrink-0 border-b px-3 py-1.5 text-xs">
          {PANES.find((entry) => entry.id === pane)?.hint}
        </p>

        {/* Each pane is mounted only while selected; Monaco keeps its model by
            `path`, so drafts survive switching tabs. */}
        <div className="min-h-0 flex-1">
          {pane === 'input' ? (
            <SchemaEditor
              path={INPUT_SCHEMA_PATH}
              theme={monacoTheme}
              value={inputSchema}
              onChange={setInputSchema}
            />
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

          {pane === 'output' ? (
            <SchemaEditor
              path={OUTPUT_SCHEMA_PATH}
              theme={monacoTheme}
              value={outputSchema}
              onChange={setOutputSchema}
            />
          ) : null}

          {pane === 'layout' ? (
            <JsonEditor
              className="h-full"
              path={SPEC_PATH}
              schema={specSchema}
              theme={monacoTheme}
              value={specDraft}
              onChange={setSpecDraft}
            />
          ) : null}

          {pane === 'data' ? (
            <JsonEditor
              className="h-full"
              path={INPUT_DATA_PATH}
              theme={monacoTheme}
              value={inputDraft}
              onChange={setInputDraft}
            />
          ) : null}
        </div>
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
