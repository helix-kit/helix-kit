'use client';

import { Badge } from '@helix-hq/design-system/components/badge';
import { Check, Loader2, Wrench, X } from 'lucide-react';

type ToolPart = {
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const pretty = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const ToolCard = ({ name, part }: { name: string; part: ToolPart }) => {
  const errored = part.state === 'output-error';
  const running = part.state !== 'output-available' && !errored;

  const statusBadge = () => {
    if (running) {
      return (
        <Badge className="gap-1" variant="secondary">
          <Loader2 className="size-3 animate-spin" />
          Running
        </Badge>
      );
    }
    if (errored) {
      return (
        <Badge className="gap-1" variant="destructive">
          <X className="size-3" />
          Error
        </Badge>
      );
    }
    return (
      <Badge className="gap-1" variant="outline">
        <Check className="size-3" />
        Done
      </Badge>
    );
  };

  const resultBlock = () => {
    if (errored) {
      return (
        <p className="text-destructive border-t px-3 py-1.5">{part.errorText ?? 'Tool failed.'}</p>
      );
    }
    if (part.output === undefined) {
      return null;
    }
    return (
      <details className="border-t px-3 py-1.5">
        <summary className="text-muted-foreground cursor-pointer select-none">Result</summary>
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap">{pretty(part.output)}</pre>
      </details>
    );
  };

  const hasInput =
    part.input !== undefined && part.input !== null && Object.keys(part.input).length > 0;

  return (
    <div className="bg-muted/40 rounded-md border text-xs">
      <div className="flex items-center gap-2 px-3 py-2">
        <Wrench className="text-muted-foreground size-3.5" />
        <span className="font-mono font-medium">{name}</span>
        {statusBadge()}
      </div>
      {hasInput ? (
        <details className="border-t px-3 py-1.5">
          <summary className="text-muted-foreground cursor-pointer select-none">Input</summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{pretty(part.input)}</pre>
        </details>
      ) : null}
      {resultBlock()}
    </div>
  );
};
