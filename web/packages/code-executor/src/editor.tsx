'use client';

import { useEffect, useRef } from 'react';

import { Editor } from '@monaco-editor/react';

import { describeEnvironment } from './declarations';

import type { HostFunctions } from './types';
import type { JSONSchema } from 'zod/v4/core';

/**
 * The subset of Monaco's TypeScript API this uses.
 *
 * Declared locally because `@monaco-editor/react` types `monaco` loosely and the
 * real `monaco-editor` types are not a dependency here.
 */
type MonacoTypeScriptApi = {
  languages: {
    typescript: {
      ScriptTarget: { ESNext: number };
      ModuleKind: { ESNext: number };
      typescriptDefaults: {
        addExtraLib: (content: string, filePath?: string) => { dispose: () => void };
        setCompilerOptions: (options: Record<string, unknown>) => void;
        setDiagnosticsOptions: (options: { diagnosticCodesToIgnore: number[] }) => void;
      };
    };
  };
};

const TYPES_PATH = 'ts:helix-code-env.d.ts';

// The code is a function body, so a bare `return` is legal here even though
// TypeScript would otherwise call it a top-level return.
const RETURN_OUTSIDE_FUNCTION = 1108;

/**
 * Monaco configured for code this package will execute.
 *
 * The declarations come from `describeEnvironment`, so the editor describes
 * exactly what a run will bind: `input` typed from the schema, and a signature
 * per host function. Author-time completion and run-time behaviour therefore
 * cannot disagree.
 */
export const CodeEditor = ({
  className,
  inputSchema,
  functions,
  theme,
  value,
  onChange,
}: {
  className?: string;
  /** Types `input`. Omit for an editor over an untyped environment. */
  inputSchema?: JSONSchema._JSONSchema;
  /** Declared as callable globals, matching what the executor binds. */
  functions?: HostFunctions;
  theme: 'light' | 'vs-dark';
  value: string;
  onChange: (value: string) => void;
}) => {
  const monacoRef = useRef<MonacoTypeScriptApi | null>(null);
  const libRef = useRef<{ dispose: () => void } | null>(null);

  // Re-declare whenever the schema changes, so editing the input schema updates
  // completions in the code pane without a reload.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (monaco === null) {
      return;
    }

    libRef.current?.dispose();
    libRef.current = monaco.languages.typescript.typescriptDefaults.addExtraLib(
      describeEnvironment({ inputSchema, functions }),
      TYPES_PATH,
    );
  }, [functions, inputSchema]);

  useEffect(() => () => libRef.current?.dispose(), []);

  return (
    <Editor
      className={className}
      defaultLanguage="typescript"
      options={{
        automaticLayout: true,
        fontFamily: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace',
        fontSize: 13,
        lineNumbersMinChars: 3,
        minimap: { enabled: false },
        padding: { top: 12 },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
      }}
      path="helix-code.ts"
      theme={theme}
      value={value}
      onChange={(next) => {
        onChange(next ?? '');
      }}
      onMount={(unusedEditor, monaco) => {
        const api = monaco as unknown as MonacoTypeScriptApi;
        monacoRef.current = api;

        api.languages.typescript.typescriptDefaults.setCompilerOptions({
          target: api.languages.typescript.ScriptTarget.ESNext,
          module: api.languages.typescript.ModuleKind.ESNext,
          strict: true,
          noEmit: true,
          allowNonTsExtensions: true,
        });
        api.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
          diagnosticCodesToIgnore: [RETURN_OUTSIDE_FUNCTION],
        });

        libRef.current?.dispose();
        libRef.current = api.languages.typescript.typescriptDefaults.addExtraLib(
          describeEnvironment({ inputSchema, functions }),
          TYPES_PATH,
        );
      }}
    />
  );
};
