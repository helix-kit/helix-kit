'use client';

import { Editor } from '@monaco-editor/react';

/** Monaco configured for JSON authoring; sizes itself to its container. */
export const JsonEditorPane = ({
  className,
  path,
  theme,
  value,
  onChange,
}: {
  className?: string;
  path: string;
  theme: 'light' | 'vs-dark';
  value: string;
  onChange: (value: string) => void;
}) => (
  <Editor
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
