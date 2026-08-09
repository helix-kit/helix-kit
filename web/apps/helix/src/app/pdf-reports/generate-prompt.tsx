'use client';

import { useRef, useState } from 'react';

import { useChat } from '@ai-sdk/react';
import { createArtifactCollector, type ArtifactEvent } from '@helix/ai-kit';
import { Button } from '@helix/design-system/components/button';
import { Textarea } from '@helix/design-system/components/textarea';
import { applyReportPatchLine, REPORT_ARTIFACTS, type ReportTemplate } from '@helix/pdf-report';
import { DefaultChatTransport } from 'ai';
import { Brain, Check, History, Loader2, Sparkles, Square, Wrench, X } from 'lucide-react';

const ENDPOINT = '/api/pdf-report/generate';

/** Cheap models worth comparing on the same task, plus whatever the server defaults to. */
const MODELS = [
  { id: '', label: 'Server default' },
  { id: 'deepseek/deepseek-v4-flash-0731', label: 'DeepSeek v4 Flash' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek v4 Pro' },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'openai/gpt-5', label: 'GPT-5' },
];

/**
 * Development only: run the real model, or replay the last one that did.
 *
 * A real run always keeps its turn, so the slot holds the most recent one and a
 * later replay gets it. Recording is not a separate choice because a real turn
 * that was not kept is a real turn that has to be paid for twice.
 */
const FIXTURES = [
  { id: 'live', label: 'Real model' },
  { id: 'replay', label: 'Last recorded turn' },
] as const;

type FixtureChoice = (typeof FIXTURES)[number]['id'];

type ToolRun = { id: string; name: string; state: 'running' | 'done' | 'failed' };

/**
 * What the turn is doing, in the order it did it.
 *
 * Derived from the message rather than tracked alongside it. Tracking meant a
 * tool could only be marked finished when the whole turn was, so every step sat
 * spinning until the end and a slow one was indistinguishable from a finished
 * one.
 */
type Step =
  | { kind: 'thinking'; id: string; text: string; done: boolean }
  | { kind: 'tool'; id: string; name: string; state: ToolRun['state'] };

type MessagePart = {
  type: string;
  text?: string;
  state?: string;
  toolCallId?: string;
  errorText?: string;
  output?: unknown;
};

/**
 * A tool that reported a problem failed, whether or not the call did.
 *
 * Tool errors come back as output rather than thrown, so the model can read them
 * and correct itself. That makes them invisible to a state check alone: the step
 * shows a tick while the model is being told its patch was rejected, and the only
 * account the reader gets is prose claiming the work was done.
 */
const toolState = (part: MessagePart): ToolRun['state'] => {
  if (part.state === 'output-error') {
    return 'failed';
  }
  if (part.state !== 'output-available') {
    return 'running';
  }
  const { output } = part;
  const reported =
    typeof output === 'object' &&
    output !== null &&
    'error' in output &&
    typeof (output as { error: unknown }).error === 'string';

  return reported ? 'failed' : 'done';
};

const buildSteps = (parts: MessagePart[]): Step[] =>
  parts.flatMap<Step>((part, index) => {
    if (part.type === 'reasoning') {
      const text = (part.text ?? '').trim();
      return text === ''
        ? []
        : [
            {
              kind: 'thinking' as const,
              id: `reasoning-${String(index)}`,
              text,
              done: part.state !== 'streaming',
            },
          ];
    }
    if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
      return [
        {
          kind: 'tool' as const,
          id: part.toolCallId ?? `tool-${String(index)}`,
          name: part.type === 'dynamic-tool' ? 'tool' : part.type.slice('tool-'.length),
          state: toolState(part),
        },
      ];
    }
    return [];
  });

const ToolIcon = ({ state }: { state: ToolRun['state'] }) => {
  if (state === 'running') {
    return <Loader2 className="size-3 shrink-0 animate-spin" />;
  }
  if (state === 'failed') {
    return <X className="text-destructive size-3 shrink-0" />;
  }
  return <Check className="size-3 shrink-0 text-emerald-500" />;
};

const MS_PER_SECOND = 1000;
/** Below this a tool is instant, and a number next to every row is just noise. */
const WORTH_SHOWING_MS = 250;

/**
 * How long a tool actually ran, measured on the server.
 *
 * Worth showing because the intuition it corrects is strong: the steps take a
 * long time to appear, so the tools look slow. They are not — they finish in
 * milliseconds, and the wait is the model thinking and writing their arguments.
 */
const Elapsed = ({ ms }: { ms: number | undefined }) =>
  ms === undefined || ms < WORTH_SHOWING_MS ? null : (
    <span className="text-muted-foreground/60 shrink-0 tabular-nums">
      {(ms / MS_PER_SECOND).toFixed(1)}s
    </span>
  );

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
  fixturesAvailable = false,
}: {
  /** Read when refining, so the model sees the template as it stands. */
  currentDocument: () => ReportTemplate;
  /** Fires per artifact, as it arrives. */
  onArtifact: (patch: Partial<ReportTemplate>) => void;
  /** Whether this build can record and replay turns at all. */
  fixturesAvailable?: boolean;
}) => {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [fixture, setFixture] = useState<FixtureChoice>('live');
  const [replaying, setReplaying] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [openThought, setOpenThought] = useState<string | null>(null);
  // How long each tool actually ran, reported by the server. Timing it here
  // would measure when React noticed, not when the work happened.
  const [durations, setDurations] = useState<Record<string, number>>({});

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

  const { messages, sendMessage, status, error, stop } = useChat({
    id: 'pdf-report-generate',
    transport: new DefaultChatTransport({ api: ENDPOINT }),
    onData: (part) => {
      if (part.type === 'data-artifact') {
        try {
          collectorRef.current.handle(part.data as ArtifactEvent);
        } catch (error) {
          // The server rejects the same patch and tells the model, which fixes
          // it and sends another. Here it only needs to not take the page down.
          setNote(error instanceof Error ? error.message : 'A layout patch was rejected.');
        }
      }
      if (part.type === 'data-tool-timing') {
        const { toolCallId, durationMs } = part.data as {
          toolCallId: string;
          durationMs: number;
        };
        setDurations((current) => ({ ...current, [toolCallId]: durationMs }));
      }
      if (part.type === 'data-fixture') {
        // Says which it actually did, which is not always what was asked: a
        // replay with nothing recorded yet has to run the model to have
        // something to replay.
        const { using } = part.data as { using: string };
        setReplaying(using === 'replay' ? 'Replayed a recorded turn — no tokens spent.' : null);
      }
    },
    onFinish: ({ message }) => {
      // A patch whose last line never got its newline is still part of the
      // layout; the turn ending is what says no more is coming.
      collectorRef.current.flush();
      const text = message.parts
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join('')
        .trim();
      setNote(text === '' ? null : text);
    },
  });

  const streaming = status === 'submitted' || status === 'streaming';

  // The turn in progress is the last assistant message; its parts are the record
  // of what happened, already in order.
  const latest = messages.findLast((message) => message.role === 'assistant');
  const steps = buildSteps((latest?.parts ?? []) as MessagePart[]);

  const generate = () => {
    setDurations({});
    const template = currentDocument();
    layoutRef.current = template.spec;
    setNote(null);
    setReplaying(null);

    void sendMessage(
      { text: prompt },
      {
        body: {
          prompt,
          template,
          model: model === '' ? undefined : model,
          ...(fixturesAvailable ? { fixture } : {}),
        },
      },
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
            aria-label="Model"
            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            // A replay answers with the model that was recorded, so offering a
            // choice here would be offering one that does not apply.
            disabled={fixturesAvailable ? fixture === 'replay' : false}
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
          {fixturesAvailable ? (
            <select
              aria-label="Model source"
              className="border-input bg-background h-8 rounded-md border px-2 text-xs"
              value={fixture}
              onChange={(event) => {
                setFixture(event.target.value as FixtureChoice);
              }}
            >
              {FIXTURES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          ) : null}
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

      {steps.length === 0 && note === null && replaying === null ? null : (
        <div className="space-y-1 border-t px-3 py-2">
          {replaying === null ? null : (
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
              <History className="size-3" />
              {replaying}
            </p>
          )}
          {steps.map((step) =>
            step.kind === 'thinking' ? (
              <button
                key={step.id}
                className="text-muted-foreground/80 flex w-full items-start gap-2 text-left text-xs italic"
                type="button"
                onClick={() => {
                  setOpenThought((current) => (current === step.id ? null : step.id));
                }}
              >
                {step.done ? (
                  <Brain className="mt-0.5 size-3 shrink-0" />
                ) : (
                  <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" />
                )}
                <span className={openThought === step.id ? 'whitespace-pre-wrap' : 'line-clamp-1'}>
                  {step.text}
                </span>
              </button>
            ) : (
              <div key={step.id} className="text-muted-foreground flex items-center gap-2 text-xs">
                <ToolIcon state={step.state} />
                {LABELS[step.name] ?? (
                  <span className="flex items-center gap-1">
                    <Wrench className="size-3" />
                    {step.name}
                  </span>
                )}
                <Elapsed ms={durations[step.id]} />
              </div>
            ),
          )}
          {note === null ? null : <p className="text-muted-foreground pt-1 text-xs">{note}</p>}
        </div>
      )}
    </div>
  );
};
