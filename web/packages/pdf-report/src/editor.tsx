'use client';

import { useState } from 'react';

import { defaultReportTemplate } from './defaults';
import { ReportTemplateProvider, useReportTemplate } from './editor/context';
import {
  ReportCodeField,
  ReportDemoInputField,
  ReportInputSchemaField,
  ReportLayoutField,
  ReportOutputSchemaField,
} from './editor/fields';
import { ReportPreview } from './editor/preview';

import type { ReportBranding, ReportTemplate } from './types';

export { ReportTemplateProvider, useReportTemplate } from './editor/context';
export type { ReportTemplateProviderProps, ReportTemplateState } from './editor/context';
export {
  ReportCodeField,
  ReportDemoInputField,
  ReportInputSchemaField,
  ReportLayoutField,
  ReportOutputSchemaField,
} from './editor/fields';
export { ReportPreview, useReportPreview } from './editor/preview';
export type { ReportPreviewOptions, ReportPreviewProps, ReportPreviewState } from './editor/preview';

/**
 * Ordered as the data flows: what comes in, what transforms it, what comes out,
 * how that is drawn — and the sample used to preview the whole thing.
 */
const PANES = [
  {
    id: 'input',
    label: 'Input',
    hint: 'What the report is handed. Types `input` in the code.',
    render: () => <ReportInputSchemaField />,
  },
  {
    id: 'code',
    label: 'Code',
    hint: 'Turns the input into the values below.',
    render: () => <ReportCodeField />,
  },
  {
    id: 'output',
    label: 'Output',
    hint: 'What the code returns. The layout binds to this.',
    render: () => <ReportOutputSchemaField />,
  },
  {
    id: 'layout',
    label: 'Layout',
    hint: 'Where those values are drawn on the page.',
    render: () => <ReportLayoutField />,
  },
  {
    id: 'data',
    label: 'Preview data',
    hint: 'Sample input, for the preview on the right.',
    render: () => <ReportDemoInputField />,
  },
] as const;

type PaneId = (typeof PANES)[number]['id'];

const Panes = ({ input, branding, endpoint, renderMode, previewDebounceMs }: PreviewWiring) => {
  const [pane, setPane] = useState<PaneId>('code');
  const { error } = useReportTemplate();
  const active = PANES.find((entry) => entry.id === pane) ?? PANES[1];

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
        <p className="text-muted-foreground shrink-0 border-b px-3 py-1.5 text-xs">{active.hint}</p>
        {/* Only the selected field is mounted; Monaco keeps each model by path,
            so drafts survive switching tabs. */}
        <div className="min-h-0 flex-1">{active.render()}</div>
      </div>

      <div className="bg-background flex h-full min-h-[26rem] min-w-0 flex-col overflow-hidden rounded-md border">
        <div className="flex h-10 shrink-0 items-center border-b px-3">
          <span className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
            Preview
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <ReportPreview
            branding={branding}
            debounceMs={previewDebounceMs}
            endpoint={endpoint}
            input={input}
            parseError={error}
            renderMode={renderMode}
          />
        </div>
      </div>
    </div>
  );
};

type PreviewWiring = {
  input?: unknown;
  branding?: ReportBranding;
  endpoint?: string;
  renderMode?: 'client' | 'server';
  previewDebounceMs?: number;
};

export type ReportTemplateEditorProps = PreviewWiring & {
  /** The template to show. The fields follow it, so a new value replaces them. */
  defaultValue?: ReportTemplate;
  /** Fires whenever every field parses cleanly, so the host can drive a save button. */
  onChange?: (value: ReportTemplate) => void;
  /** Fires with the parse error, or null once it clears. */
  onError?: (error: string | null) => void;
  theme?: 'light' | 'dark';
};

/**
 * All five fields, tabbed, beside a live preview.
 *
 * This is one composition of the exported pieces, not the only one — a host that
 * fixes its own input schema, or previews against real data instead of a stored
 * sample, should compose `ReportTemplateProvider` with the fields it wants
 * rather than reach for a flag here.
 */
export const ReportTemplateEditor = ({
  defaultValue = defaultReportTemplate,
  onChange,
  onError,
  theme,
  ...wiring
}: ReportTemplateEditorProps) => (
  <ReportTemplateProvider theme={theme} value={defaultValue} onChange={onChange} onError={onError}>
    <Panes {...wiring} />
  </ReportTemplateProvider>
);
