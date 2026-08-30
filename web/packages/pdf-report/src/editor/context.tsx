'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';


import type { ReportTemplate } from '../types';
import type { JSONSchema } from 'zod/v4/core';

import { parseJson, prettyJson } from '../json';

/**
 * The draft state a template editor is made of.
 *
 * Two of the five parts are held as text rather than parsed values: a spec and a
 * sample input are edited as JSON, and text is the only representation that
 * survives being half-typed. The schemas come back from their editors already
 * parsed, so they are kept that way.
 */
export type ReportTemplateState = {
  inputSchema: JSONSchema._JSONSchema;
  setInputSchema: (value: JSONSchema._JSONSchema) => void;
  code: string;
  setCode: (value: string) => void;
  outputSchema: JSONSchema._JSONSchema;
  setOutputSchema: (value: JSONSchema._JSONSchema) => void;
  specDraft: string;
  setSpecDraft: (value: string) => void;
  demoInputDraft: string;
  setDemoInputDraft: (value: string) => void;
  /** The assembled template, or null while a JSON draft does not parse. */
  template: ReportTemplate | null;
  /** Why `template` is null, or null when it is not. */
  error: string | null;
  monacoTheme: 'light' | 'vs-dark';
};

const ReportTemplateContext = createContext<ReportTemplateState | null>(null);

/**
 * Reads the surrounding editor state.
 *
 * Throws rather than returning null: every editor field is meaningless outside a
 * provider, and a thrown message names the mistake where a null would surface
 * later as an unrelated crash.
 */
export const useReportTemplate = (): ReportTemplateState => {
  const state = useContext(ReportTemplateContext);
  if (state === null) {
    throw new Error('useReportTemplate must be used within a <ReportTemplateProvider>');
  }
  return state;
};

export type ReportTemplateProviderProps = {
  /** The template to edit. A new value reseeds every draft. */
  value: ReportTemplate;
  /** Fires whenever all drafts parse cleanly and the result differs from the last. */
  onChange?: (template: ReportTemplate) => void;
  /** Fires with the parse error, or null once it clears. */
  onError?: (error: string | null) => void;
  theme?: 'light' | 'dark';
  children: React.ReactNode;
};

/**
 * Owns the drafts; renders nothing.
 *
 * Splitting this from the fields is what lets a host lay the editor out however
 * it likes — or leave a field out entirely, which is the normal case when the
 * schema is fixed by the application rather than authored per template.
 */
export const ReportTemplateProvider = ({
  value,
  onChange,
  onError,
  theme = 'light',
  children,
}: ReportTemplateProviderProps) => {
  const [inputSchema, setInputSchema] = useState<JSONSchema._JSONSchema>(value.inputSchema);
  const [code, setCode] = useState(value.code);
  const [outputSchema, setOutputSchema] = useState<JSONSchema._JSONSchema>(value.outputSchema);
  const [specDraft, setSpecDraft] = useState(() => prettyJson(value.spec));
  const [demoInputDraft, setDemoInputDraft] = useState(() => prettyJson(value.demoInput));

  const lastCommittedRef = useRef(JSON.stringify(value));

  // Reseeded during render rather than in an effect: an effect paints the
  // previous template first and corrects it immediately after, which reads as a
  // flicker on every externally supplied change.
  const [seeded, setSeeded] = useState(value);
  if (seeded !== value) {
    setSeeded(value);
    setInputSchema(value.inputSchema);
    setCode(value.code);
    setOutputSchema(value.outputSchema);
    setSpecDraft(prettyJson(value.spec));
    setDemoInputDraft(prettyJson(value.demoInput));
  }

  const parsed = useMemo<{ template: ReportTemplate | null; error: string | null }>(() => {
    try {
      return {
        template: {
          inputSchema,
          code,
          outputSchema,
          spec: parseJson(specDraft, 'Layout JSON') as ReportTemplate['spec'],
          demoInput: parseJson(demoInputDraft, 'Preview data'),
        },
        error: null,
      };
    } catch (error) {
      return {
        template: null,
        error: error instanceof Error ? error.message : 'Invalid JSON',
      };
    }
  }, [code, demoInputDraft, inputSchema, outputSchema, specDraft]);

  useEffect(() => {
    onError?.(parsed.error);
    if (parsed.template === null) {
      return;
    }
    const serialized = JSON.stringify(parsed.template);
    if (serialized !== lastCommittedRef.current) {
      lastCommittedRef.current = serialized;
      onChange?.(parsed.template);
    }
  }, [onChange, onError, parsed]);

  const state = useMemo<ReportTemplateState>(
    () => ({
      inputSchema,
      setInputSchema,
      code,
      setCode,
      outputSchema,
      setOutputSchema,
      specDraft,
      setSpecDraft,
      demoInputDraft,
      setDemoInputDraft,
      template: parsed.template,
      error: parsed.error,
      monacoTheme: theme === 'dark' ? 'vs-dark' : 'light',
    }),
    [code, demoInputDraft, inputSchema, outputSchema, parsed, specDraft, theme],
  );

  return <ReportTemplateContext value={state}>{children}</ReportTemplateContext>;
};
