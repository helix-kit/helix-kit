'use client';

import { useRef, useState } from 'react';

import { Button } from '@helix/design-system/components/button';
import { Textarea } from '@helix/design-system/components/textarea';
import {
  createReportStreamReader,
  prettyJson,
  type ReportTemplate,
  type ReportSpec,
} from '@helix/pdf-report';
import { Loader2, Sparkles, Square } from 'lucide-react';

const ENDPOINT = '/api/pdf-report/generate';

// Provider errors arrive colourized for a terminal; the codes are noise here.
// eslint-disable-next-line no-control-regex -- matching the escapes is the point
const ANSI = /\u001b\[[0-9;]*m/g;

export const GeneratePrompt = ({
  currentDocument,
  onGenerated,
}: {
  /** Read as `currentSpec`, which puts the model into patch-only refine mode. */
  currentDocument: () => ReportTemplate;
  /** Fires with the compiled spec once the stream completes. */
  onGenerated: (spec: ReportSpec) => void;
}) => {
  const [prompt, setPrompt] = useState('');
  const [spec, setSpec] = useState<ReportSpec | null>(null);
  const [patchCount, setPatchCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const generate = async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const startingSpec = currentDocument().spec;

    try {
      setIsStreaming(true);
      setError(null);
      setSpec(null);
      setPatchCount(0);

      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, currentSpec: startingSpec }),
        signal: controller.signal,
      });

      if (!response.ok || response.body === null) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }

      // The model emits SpecStream — JSONL patch lines — optionally mixed with
      // prose, so the reader classifies each line: patches build the spec, the
      // rest is kept so a failure has something to say.
      const stream = createReportStreamReader(startingSpec);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        stream.push(value);
        if (stream.patchCount() > 0) {
          setPatchCount(stream.patchCount());
          setSpec({ ...stream.spec() });
        }
      }
      stream.flush();

      if (stream.patchCount() === 0) {
        // ANSI is stripped here, not per chunk: an escape sequence can straddle a
        // chunk boundary, so it only matches reliably on the whole string.
        const message = stream.text().replace(ANSI, '').trim();
        throw new Error(message === '' ? 'Empty response' : message);
      }

      const finalSpec = stream.spec();
      setPatchCount(stream.patchCount());
      setSpec(finalSpec);
      onGenerated(finalSpec);
    } catch (nextError) {
      if (!controller.signal.aborted) {
        setError(nextError instanceof Error ? nextError.message : 'Generation failed');
      }
    } finally {
      setIsStreaming(false);
      controllerRef.current = null;
    }
  };

  return (
    <div className="bg-background shrink-0 rounded-md border">
      <div className="flex items-start gap-2 p-3">
        <Textarea
          className="min-h-[2.5rem] flex-1 resize-none"
          placeholder="Describe the report to generate — e.g. “a monthly uptime summary grouped by profile, with a donut of faults”"
          rows={2}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void generate();
            }
          }}
        />
        {isStreaming ? (
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => {
              controllerRef.current?.abort();
            }}
          >
            <Square />
            Stop
          </Button>
        ) : (
          <Button
            disabled={prompt.trim() === ''}
            size="sm"
            type="button"
            onClick={() => {
              void generate();
            }}
          >
            <Sparkles />
            Generate
          </Button>
        )}
      </div>

      {error === null ? null : (
        <div className="text-destructive border-destructive/30 bg-destructive/5 border-t px-3 py-2 font-mono text-xs whitespace-pre-wrap">
          {error}
        </div>
      )}

      {spec === null && !isStreaming ? null : (
        <div className="border-t">
          <div className="text-muted-foreground flex items-center gap-2 px-3 py-1.5 text-xs font-medium tracking-[0.16em] uppercase">
            {isStreaming ? <Loader2 className="size-3 animate-spin" /> : null}
            Compiled spec
            <span className="text-muted-foreground/70 normal-case">
              {patchCount} patch{patchCount === 1 ? '' : 'es'} applied
            </span>
          </div>
          <pre className="bg-muted/40 max-h-56 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap">
            {spec === null ? '…' : prettyJson(spec)}
          </pre>
        </div>
      )}
    </div>
  );
};
