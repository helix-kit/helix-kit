'use client';

import { useCallback, useRef, useState } from 'react';

import { Button } from '@helix/design-system/components/button';
import { useTheme } from '@helix/design-system/components/theme-provider';
import { defaultReportDocument, type ReportDocument } from '@helix/pdf-report';
import { fetchReportPdf } from '@helix/pdf-report/client';
import { ReportTemplateEditor } from '@helix/pdf-report/editor';
import { Download, Loader2, RotateCcw } from 'lucide-react';

const DOWNLOAD_FILENAME = 'helix-report.pdf';
const OBJECT_URL_REVOKE_DELAY_MS = 60_000;

export const PdfReportEditor = () => {
  const { resolvedTheme } = useTheme();
  // Remounting the editor is how a reset discards the Monaco drafts.
  const [editorKey, setEditorKey] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const documentRef = useRef<ReportDocument>(defaultReportDocument);

  const handleChange = useCallback((next: ReportDocument) => {
    documentRef.current = next;
  }, []);

  const download = async () => {
    try {
      setIsDownloading(true);
      setDownloadError(null);

      const blob = await fetchReportPdf({
        document: documentRef.current,
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
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Failed to render the PDF');
    } finally {
      setIsDownloading(false);
    }
  };

  const error = parseError ?? downloadError;

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PDF report templates</h1>
          <p className="text-muted-foreground text-sm">
            Edit the json-render template on the left; the right pane is the real server render.
            Preview data drives both the preview and the download.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => {
              documentRef.current = defaultReportDocument;
              setParseError(null);
              setDownloadError(null);
              setEditorKey((key) => key + 1);
            }}
          >
            <RotateCcw />
            Reset
          </Button>
          <Button
            disabled={isDownloading || parseError !== null}
            size="sm"
            type="button"
            onClick={() => {
              void download();
            }}
          >
            {isDownloading ? <Loader2 className="animate-spin" /> : <Download />}
            Download PDF
          </Button>
        </div>
      </div>

      <ReportTemplateEditor
        key={editorKey}
        branding={{ title: 'Helix report' }}
        theme={resolvedTheme}
        onChange={handleChange}
        onError={setParseError}
      />

      {error === null ? null : (
        <div className="text-destructive border-destructive/30 bg-destructive/5 shrink-0 rounded-md border px-4 py-3 text-sm">
          {error}
        </div>
      )}
    </>
  );
};
