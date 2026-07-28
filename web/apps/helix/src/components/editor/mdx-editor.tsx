'use client';

import { forwardRef } from 'react';

import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeCodeMirrorLanguage,
  CodeToggle,
  ConditionalContents,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type MDXEditorMethods,
} from '@mdxeditor/editor';
import { toast } from 'sonner';

import { onUpload } from './upload';

import '@mdxeditor/editor/style.css';

// Languages offered in the code-block dropdown. CodeMirror support is loaded
// dynamically via @codemirror/language-data, so this is just the visible list.
// `mermaid` is here because remarkMdxMermaid renders a ```mermaid fence as a
// diagram on the public site — in the editor it stays an ordinary code block.
const codeBlockLanguages: Record<string, string> = {
  '': 'Plain text',
  bash: 'Shell',
  c: 'C',
  cpp: 'C++',
  go: 'Go',
  html: 'HTML',
  ini: 'INI',
  javascript: 'JavaScript',
  json: 'JSON',
  kotlin: 'Kotlin',
  mermaid: 'Mermaid diagram',
  python: 'Python',
  sql: 'SQL',
  tsx: 'TSX',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
};

type EditorProps = {
  markdown: string;
  onChange?: (markdown: string) => void;
};

/**
 * MDX authoring surface for blog posts. Stores GitHub-flavored Markdown/MDX text
 * (post.content), which the public blog compiles through the same fumadocs
 * pipeline the docs use — see src/lib/blog-mdx.ts.
 */
const Editor = forwardRef<MDXEditorMethods, EditorProps>(({ markdown, onChange }, ref) => (
  <MDXEditor
    ref={ref}
    className="border-border/70 bg-background dark-theme:!bg-background rounded-md border"
    contentEditableClassName="prose prose-zinc dark:prose-invert max-w-none min-h-[24rem] px-3 py-2"
    markdown={markdown}
    plugins={[
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
      imagePlugin({ imageUploadHandler: onUpload }),
      codeBlockPlugin({ defaultCodeBlockLanguage: 'bash' }),
      codeMirrorPlugin({ codeBlockLanguages }),
      diffSourcePlugin({ viewMode: 'rich-text' }),
      markdownShortcutPlugin(),
      toolbarPlugin({
        toolbarContents: () => (
          <DiffSourceToggleWrapper>
            <UndoRedo />
            <Separator />
            <BoldItalicUnderlineToggles />
            <CodeToggle />
            <Separator />
            <BlockTypeSelect />
            <ListsToggle />
            <Separator />
            <CreateLink />
            <InsertImage />
            <InsertTable />
            <InsertThematicBreak />
            <ConditionalContents
              options={[
                { when: (e) => e?.editorType === 'codeblock', contents: () => <ChangeCodeMirrorLanguage /> },
                { fallback: () => <InsertCodeBlock /> },
              ]}
            />
          </DiffSourceToggleWrapper>
        ),
      }),
    ]}
    onChange={(value, initialMarkdownNormalize) => {
      // MDXEditor fires onChange once on mount, while it re-serializes the source
      // into its own markdown flavour (e.g. `-` bullets become `*`). That is not a
      // user edit — forwarding it would autosave a rewrite of a post merely
      // because someone opened it, bumping updatedAt and churning the content.
      if (initialMarkdownNormalize) return;
      onChange?.(value);
    }}
    onError={(payload) => {
      // MDX that the editor cannot parse into its model (stray JSX, bad syntax)
      // would otherwise fail silently and risk saving mangled content.
      toast.error(`MDX parse error: ${payload.error}`);
    }}
  />
));

Editor.displayName = 'MdxEditor';

export default Editor;
