'use client';

import { Editor } from '@monaco-editor/react';

/** Attaches a JSON Schema to one editor model, by file URI. */
export type JsonEditorSchema = {
  /** Matched against the pane's `path`. */
  fileMatch: string;
  schema: object;
};

type SchemaEntry = { uri: string; fileMatch?: string[]; schema?: object };

/**
 * The slice of the Monaco API this pane touches. `@monaco-editor/react` types
 * `beforeMount` against `monaco-editor`, which is loaded at runtime from a CDN
 * and is not a dependency here, so the parameter arrives untyped.
 */
type MonacoJsonApi = {
  languages: {
    json: {
      jsonDefaults: {
        diagnosticsOptions: { schemas?: SchemaEntry[] };
        setDiagnosticsOptions: (options: {
          validate: boolean;
          enableSchemaRequest: boolean;
          schemas: SchemaEntry[];
        }) => void;
      };
    };
  };
};

/** Monaco configured for JSON authoring; sizes itself to its container. */
export const JsonEditorPane = ({
  className,
  path,
  schema,
  theme,
  value,
  onChange,
}: {
  className?: string;
  path: string;
  /** Drives completion, hover docs and inline validation for this model. */
  schema?: JsonEditorSchema;
  theme: 'light' | 'vs-dark';
  value: string;
  onChange: (value: string) => void;
}) => (
  <Editor
    beforeMount={(monaco: unknown) => {
      if (schema === undefined) {
        return;
      }

      const { jsonDefaults } = (monaco as MonacoJsonApi).languages.json;

      // Schemas are registered globally and keyed by `fileMatch`, so re-register
      // the whole list rather than appending a duplicate on every mount.
      const uri = `helix://pdf-report/${schema.fileMatch}`;
      const existing = (jsonDefaults.diagnosticsOptions.schemas ?? []).filter(
        (entry) => entry.uri !== uri,
      );

      jsonDefaults.setDiagnosticsOptions({
        validate: true,
        enableSchemaRequest: false,
        schemas: [...existing, { uri, fileMatch: [schema.fileMatch], schema: schema.schema }],
      });
    }}
    className={className}
    defaultLanguage="json"
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
    path={path}
    theme={theme}
    value={value}
    onChange={(nextValue) => {
      onChange(nextValue ?? '');
    }}
  />
);
