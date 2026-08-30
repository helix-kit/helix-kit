'use client';

import { useEffect, useRef, useState } from 'react';

import { useReportTemplate } from './context';

import type { ReportBranding } from '../types';

import { renderReportToBlob } from '../browser';
import { fetchReportPdf } from '../client';



// A server render costs a round trip, so it is worth waiting longer to avoid
// firing one per keystroke. A client render is local and cheap enough to feel
// immediate, so it can afford to react sooner.
const DEBOUNCE_MS = { client: 250, server: 500 } as const;

export type ReportPreviewOptions = {
  /**
   * What to render against. Defaults to the template's own `demoInput`.
   *
   * A host with real data should pass it: a preview is only worth trusting when
   * it runs on the values a recipient will actually see.
   */
  input?: unknown;
  branding?: ReportBranding;
  /** Render route for `server` mode; defaults to `/api/pdf-report`. */
  endpoint?: string;
  /**
   * `client` skips the round trip, which makes editing feel immediate; `server`
   * proves what a delivered document contains. Both run the same pipeline.
   */
  renderMode?: 'client' | 'server';
  debounceMs?: number;
};

export type ReportPreviewState = {
  /** Object URL of the most recent successful render, or null before the first. */
  url: string | null;
  /** The current render failure, or null. The last good `url` is kept alongside it. */
  error: string | null;
  isRendering: boolean;
};

/**
 * Renders the surrounding template to a PDF, debounced.
 *
 * Headless, so a host can present the result however it wants — an iframe, a
 * download button, a page-thumbnail strip.
 */
export const useReportPreview = ({
  input,
  branding,
  endpoint,
  renderMode = 'client',
  debounceMs,
}: ReportPreviewOptions = {}): ReportPreviewState => {
  const { template } = useReportTemplate();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const urlRef = useRef<string | null>(null);

  const wait = debounceMs ?? DEBOUNCE_MS[renderMode];
  // The template is an object rebuilt each parse, so identity changes on every
  // keystroke. Comparing its serialisation is what keeps the effect from firing
  // when nothing actually differs.
  const key = template === null ? null : JSON.stringify(template);

  useEffect(() => {
    if (template === null) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsRendering(true);
      const render = async () => {
        try {
          const blob =
            renderMode === 'client'
              ? await renderReportToBlob(template, { input, branding })
              : await fetchReportPdf({
                  template,
                  input,
                  branding,
                  endpoint,
                  filename: 'helix-report-preview.pdf',
                  signal: controller.signal,
                });

          // A client render cannot be aborted mid-flight, so drop a result a
          // newer edit has already superseded.
          if (controller.signal.aborted) {
            return;
          }

          const objectUrl = URL.createObjectURL(blob);
          if (urlRef.current !== null) {
            URL.revokeObjectURL(urlRef.current);
          }
          urlRef.current = objectUrl;
          setUrl(objectUrl);
          // Cleared here rather than before the attempt: clearing it up front
          // makes an error vanish and reappear on every keystroke, which reads
          // as flashing rather than as one problem.
          setError(null);
        } catch (renderError) {
          if (controller.signal.aborted) {
            return;
          }
          setError(
            renderError instanceof Error ? renderError.message : 'Failed to render the preview',
          );
        } finally {
          if (!controller.signal.aborted) {
            setIsRendering(false);
          }
        }
      };

      void render();
    }, wait);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` stands in for `template`; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branding, endpoint, input, key, renderMode, wait]);

  useEffect(
    () => () => {
      if (urlRef.current !== null) {
        URL.revokeObjectURL(urlRef.current);
      }
    },
    [],
  );

  return { url, error, isRendering };
};

export type ReportPreviewProps = ReportPreviewOptions & {
  className?: string;
  /** Shown when a draft does not parse, alongside the last good render. */
  parseError?: string | null;
};

/**
 * The rendered document.
 *
 * The last good render stays on screen while something is wrong with the next
 * version of it, with the problem stated above it — swapping the document out
 * for the message loses the only thing that shows what the message is about.
 */
export const ReportPreview = ({ className = 'h-full', parseError, ...options }: ReportPreviewProps) => {
  const { url, error } = useReportPreview(options);
  const message: string | null = parseError ?? error;

  if (url === null) {
    return (
      <div className={className}>
        {message === null ? (
          <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm">
            Rendering preview…
          </div>
        ) : (
          <div className="text-destructive h-full overflow-auto px-6 py-4 font-mono text-xs whitespace-pre-wrap">
            {message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${className}`}>
      {message === null ? null : (
        <div className="text-destructive border-destructive/30 bg-destructive/5 max-h-32 shrink-0 overflow-auto border-b px-4 py-2 font-mono text-xs whitespace-pre-wrap">
          {message}
        </div>
      )}
      <iframe
        className={`w-full flex-1 ${message === null ? '' : 'opacity-60'}`}
        src={url}
        title="PDF preview"
      />
    </div>
  );
};
