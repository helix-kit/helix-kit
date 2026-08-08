'use client';

import { useEffect, useRef, useState } from 'react';

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@helix/design-system/components/resizable';
import { cn } from '@helix/design-system/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { PanelImperativeHandle } from 'react-resizable-panels';
import type { JSONSchema } from 'zod/v4/core';

import { JsonSchemaBuilder } from '../builder';
import { JsonEditor } from '../editor';

const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

/** Percentages, since the panel group works in proportions of its height. */
const FULL_SIZE = 100;
const DEFAULT_RAW_SIZE = 35;
const MIN_RAW_SIZE = 12;
const MIN_BUILDER_SIZE = 20;

/**
 * Collapsed height. Not zero: the header carries the control that expands it
 * again, so collapsing to nothing would leave no way back.
 */
const COLLAPSED_SIZE = '28px';

export type SchemaEditorProps = {
  value: JSONSchema._JSONSchema;
  onChange: (schema: JSONSchema.JSONSchema) => void;
  /** Distinguishes this editor's Monaco model from others on the page. */
  path: string;
  theme: 'light' | 'vs-dark';
  className?: string;
};

/**
 * A schema, editable two ways at once.
 *
 * The property list is faster for ordinary edits and shows the shape at a
 * glance; raw JSON is the escape hatch for anything the list cannot express, and
 * for pasting a schema in wholesale. Offering only one of them means somebody is
 * always fighting the wrong tool, so both are here and stay in step.
 *
 * The split is draggable and the JSON half collapses, because which half matters
 * changes constantly: sketching a shape wants the list, chasing a binding wants
 * the JSON, and neither deserves a fixed share of the height.
 *
 * Raw text is kept separately from the parsed value and only regenerated when the
 * schema changes from elsewhere. Reformatting on every keystroke would move the
 * caret out from under whoever is typing.
 */
export const SchemaEditor = ({ value, onChange, path, theme, className }: SchemaEditorProps) => {
  const [raw, setRaw] = useState(() => pretty(value));
  const [rawError, setRawError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const rawPanelRef = useRef<PanelImperativeHandle>(null);

  // What the raw pane last agreed with, so an edit made here does not bounce
  // back through the effect and reformat itself.
  const settledRef = useRef(JSON.stringify(value));

  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (serialized !== settledRef.current) {
      settledRef.current = serialized;
      setRaw(pretty(value));
      setRawError(null);
    }
  }, [value]);

  const commit = (next: JSONSchema.JSONSchema) => {
    settledRef.current = JSON.stringify(next);
    onChange(next);
  };

  return (
    <ResizablePanelGroup className={cn('h-full', className)} orientation="vertical">
      <ResizablePanel
        className="min-h-0"
        defaultSize={FULL_SIZE - DEFAULT_RAW_SIZE}
        minSize={MIN_BUILDER_SIZE}
      >
        <div className="h-full overflow-auto p-2">
          <JsonSchemaBuilder
            value={value}
            onValueChange={(next) => {
              setRaw(pretty(next));
              setRawError(null);
              commit(next);
            }}
          />
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel
        className="flex min-h-0 flex-col"
        collapsedSize={COLLAPSED_SIZE}
        collapsible
        defaultSize={DEFAULT_RAW_SIZE}
        minSize={MIN_RAW_SIZE}
        panelRef={rawPanelRef}
        // Also catches a drag that crosses the collapse threshold, not just the
        // header button.
        onResize={() => {
          setCollapsed(rawPanelRef.current?.isCollapsed() ?? false);
        }}
      >
        <button
          aria-expanded={!collapsed}
          className="text-muted-foreground hover:text-foreground flex h-7 w-full shrink-0 items-center gap-2 px-3 text-left text-xs font-medium tracking-[0.16em] uppercase"
          type="button"
          onClick={() => {
            const panel = rawPanelRef.current;
            if (panel === null) {
              return;
            }
            if (panel.isCollapsed()) {
              panel.expand();
            } else {
              panel.collapse();
            }
          }}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
          JSON
          {rawError === null ? null : (
            <span className="text-destructive ml-auto normal-case">{rawError}</span>
          )}
        </button>

        {collapsed ? null : (
          <div className="min-h-0 flex-1 border-t">
            <JsonEditor
              className="h-full"
              path={path}
              theme={theme}
              value={raw}
              onChange={(next) => {
                setRaw(next);
                try {
                  const parsed = JSON.parse(next) as JSONSchema.JSONSchema;
                  setRawError(null);
                  commit(parsed);
                } catch (error) {
                  // Mid-edit JSON is routinely invalid; surface it and leave the
                  // last good schema in place rather than clearing the builder.
                  setRawError(error instanceof Error ? error.message : 'Invalid JSON');
                }
              }}
            />
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
