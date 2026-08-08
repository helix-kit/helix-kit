'use client';

import { useRef, useState } from 'react';

import { useChat } from '@ai-sdk/react';
import { createArtifactCollector, type ArtifactEvent } from '@helix/ai-kit';
import { Button } from '@helix/design-system/components/button';
import { Textarea } from '@helix/design-system/components/textarea';
import { applyReportPatchLine, REPORT_ARTIFACTS, type ReportTemplate } from '@helix/pdf-report';
import { DefaultChatTransport } from 'ai';
import { Check, Loader2, Sparkles, Square, Wrench, X } from 'lucide-react';

const ENDPOINT = '/api/pdf-report/generate';

/** Cheap models worth comparing on the same task, plus whatever the server defaults to. */
const MODELS = [
  { id: '', label: 'Server default' },
  { id: 'deepseek/deepseek-v4-flash-0731', label: 'DeepSeek v4 Flash' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek v4 Pro' },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'openai/gpt-5', label: 'GPT-5' },
];

type ToolRun = { id: string; name: string; state: 'running' | 'done' | 'failed' };

const ToolIcon = ({ state }: { state: ToolRun['state'] }) => {
  if (state === 'running') {
    return <Loader2 className="size-3 shrink-0 animate-spin" />;
  }
  if (state === 'failed') {
    return <X className="text-destructive size-3 shrink-0" />;
  }
  return <Check className="size-3 shrink-0 text-emerald-500" />;
};

const LABELS: Record<string, string> = {
  write_report_input_schema: 'Input schema',
  write_report_output_schema: 'Output schema',
  write_report_code: 'Code',
  write_report_spec: 'Layout',
  write_report_demo_input: 'Preview data',
  try_code: 'Running the code',
  check_report: 'Checking the template',
  check_schema: 'Checking a schema',
};

export const GeneratePrompt = ({
  currentDocument,
  onArtifact,
}: {
  /** Read when refining, so the model sees the template as it stands. */
  currentDocument: () => ReportTemplate;
  /** Fires per artifact, as it arrives. */
  onArtifact: (patch: Partial<ReportTemplate>) => void;
}) => {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [tools, setTools] = useState<ToolRun[]>([]);
  const [note, setNote] = useState<string | null>(null);

  // Held across chunks: the layout arrives as patch lines that build on the spec
  // as it stands, so each line applies to the result of the last.
  const layoutRef = useRef<ReportTemplate['spec']>(currentDocument().spec);

  const collectorRef = useRef(
    createArtifactCollector(REPORT_ARTIFACTS, {
      // A kind's second segment is the template field it fills.
      onValue: (kind, value) => {
        const [, field] = kind.split('.');
        if (field !== undefined) {
          onArtifact({ [field]: value } as Partial<ReportTemplate>);
        }
      },
      onPatchLine: (_kind, line) => {
        layoutRef.current = applyReportPatchLine(layoutRef.current, line);
        onArtifact({ spec: { ...layoutRef.current } });
      },
      // A whole new layout builds from nothing: patched onto the previous one,
      // its elements would survive and bind to fields the new code never returns.
      onReset: () => {
        layoutRef.current = { root: '', elements: {} } as ReportTemplate['spec'];
      },
      onUnknown: (kind, reason) => {
        setNote(`Ignored an artifact for "${kind}": ${reason}.`);
      },
    }),
  );

  const { sendMessage, status, error, stop } = useChat({
    id: 'pdf-report-generate',
    transport: new DefaultChatTransport({ api: ENDPOINT }),
    onData: (part) => {
      if (part.type === 'data-artifact') {
        collectorRef.current.handle(part.data as ArtifactEvent);
      }
    },
    onToolCall: ({ toolCall }) => {
      setTools((current) => [
        ...current,
        { id: toolCall.toolCallId, name: toolCall.toolName, state: 'running' },
      ]);
    },
    onFinish: ({ message }) => {
      // Every tool that never reported back is finished by the time the turn is.
      setTools((current) =>
        current.map((run) => (run.state === 'running' ? { ...run, state: 'done' } : run)),
      );
      const text = message.parts
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join('')
        .trim();
      setNote(text === '' ? null : text);
    },
  });

  const streaming = status === 'submitted' || status === 'streaming';

  const generate = () => {
    const template = currentDocument();
    layoutRef.current = template.spec;
    setTools([]);
    setNote(null);

    void sendMessage(
      { text: prompt },
      { body: { prompt, template, model: model === '' ? undefined : model } },
    );
  };

  return (
    <div className="bg-background shrink-0 rounded-md border">
      <div className="flex items-start gap-2 p-3">
        <Textarea
          className="min-h-[2.5rem] flex-1 resize-none"
          placeholder="Describe the report to generate — e.g. “a monthly uptime summary grouped by profile, with a bar chart of events”"
          rows={2}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              generate();
            }
          }}
        />
        <div className="flex flex-col gap-2">
          <select
            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
            }}
          >
            {MODELS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          {streaming ? (
            <Button size="sm" type="button" variant="outline" onClick={() => void stop()}>
              <Square />
              Stop
            </Button>
          ) : (
            <Button disabled={prompt.trim() === ''} size="sm" type="button" onClick={generate}>
              <Sparkles />
              Generate
            </Button>
          )}
        </div>
      </div>

      {error === undefined ? null : (
        <div className="text-destructive border-destructive/30 bg-destructive/5 border-t px-3 py-2 font-mono text-xs whitespace-pre-wrap">
          {error.message}
        </div>
      )}

      {tools.length === 0 && note === null ? null : (
        <div className="space-y-1 border-t px-3 py-2">
          {tools.map((run) => (
            <div key={run.id} className="text-muted-foreground flex items-center gap-2 text-xs">
              <ToolIcon state={run.state} />
              {LABELS[run.name] ?? (
                <span className="flex items-center gap-1">
                  <Wrench className="size-3" />
                  {run.name}
                </span>
              )}
            </div>
          ))}
          {note === null ? null : <p className="text-muted-foreground pt-1 text-xs">{note}</p>}
        </div>
      )}
    </div>
  );
};
