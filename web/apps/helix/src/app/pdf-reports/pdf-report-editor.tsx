'use client';

import { useCallback, useRef, useState } from 'react';

import { Button } from '@helix/design-system/components/button';
import { useTheme } from '@helix/design-system/components/theme-provider';
import { defaultReportTemplate, fetchReportPdf, type ReportTemplate } from '@helix/pdf-report';
import { ReportTemplateEditor } from '@helix/pdf-report/editor';
import { Cloud, Download, Loader2, MonitorSmartphone, RotateCcw } from 'lucide-react';

import { GeneratePrompt } from './generate-prompt';

const DOWNLOAD_FILENAME = 'helix-report.pdf';
const OBJECT_URL_REVOKE_DELAY_MS = 60_000;

export const PdfReportEditor = ({ fixturesAvailable = false }: { fixturesAvailable?: boolean }) => {
  const { resolvedTheme } = useTheme();
  // Remounting the editor is how a reset discards the Monaco drafts.
  const [editorKey, setEditorKey] = useState(0);
  // Seeds the (uncontrolled) editor; generation swaps it and bumps the key.
  const [editorDocument, setEditorDocument] = useState<ReportTemplate>(defaultReportTemplate);
  const [parseError, setParseError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [renderMode, setRenderMode] = useState<'client' | 'server'>('client');
  const documentRef = useRef<ReportTemplate>(defaultReportTemplate);

  const handleChange = useCallback((next: ReportTemplate) => {
    documentRef.current = next;
  }, []);

  // A getter, so the prompt reads the live draft without re-rendering on keystrokes.
  const currentDocument = useCallback(() => documentRef.current, []);

  // Each artifact lands in its own pane as it arrives, rather than the editor
  // waiting for a whole template. No remount: the panes follow the value, and
  // remounting would discard the rendered preview on every artifact.
  const applyArtifact = useCallback((patch: Partial<ReportTemplate>) => {
    const next = { ...documentRef.current, ...patch };
    documentRef.current = next;
    setEditorDocument(next);
  }, []);

  const download = async () => {
    try {
      setIsDownloading(true);
      setDownloadError(null);

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
            Two tiers: code turns the input into display values, the layout places them. The preview
            runs the whole pipeline, so it is what a recipient would receive.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            title="Where the preview renders. Both paths validate and brand identically."
            type="button"
            variant="outline"
            onClick={() => {
              setRenderMode((mode) => (mode === 'client' ? 'server' : 'client'));
            }}
          >
            {renderMode === 'client' ? <MonitorSmartphone /> : <Cloud />}
            {renderMode === 'client' ? 'Client render' : 'Server render'}
          </Button>
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => {
              documentRef.current = defaultReportTemplate;
              setEditorDocument(defaultReportTemplate);
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

      <GeneratePrompt
        currentDocument={currentDocument}
        fixturesAvailable={fixturesAvailable}
        onArtifact={applyArtifact}
      />

      <ReportTemplateEditor
        key={editorKey}
        branding={{ title: 'Helix report' }}
        defaultValue={editorDocument}
        renderMode={renderMode}
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
