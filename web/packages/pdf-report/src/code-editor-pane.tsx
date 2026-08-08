'use client';

import { useEffect, useRef } from 'react';

import { describeEnvironment } from '@helix/code-executor';
import { Editor } from '@monaco-editor/react';

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

const TYPES_PATH = 'ts:helix-report-env.d.ts';

// The code is a function body, so a bare `return` is legal here even though
// TypeScript would otherwise call it a top-level return.
const RETURN_OUTSIDE_FUNCTION = 1108;

/**
 * Monaco configured for the report's code step.
 *
 * The declarations come from the executor, so `input` is typed from the
 * template's input schema and the author gets completion and inline errors
 * against the real shape rather than `any`.
 */
export const CodeEditorPane = ({
  className,
  inputSchema,
  theme,
  value,
  onChange,
}: {
  className?: string;
  inputSchema: JSONSchema._JSONSchema;
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
      describeEnvironment({ inputSchema }),
      TYPES_PATH,
    );
  }, [inputSchema]);

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
      path="helix-report-code.ts"
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
          describeEnvironment({ inputSchema }),
          TYPES_PATH,
        );
      }}
    />
  );
};
