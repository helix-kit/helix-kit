import 'server-only';

import { createCompiler } from '@fumadocs/mdx-remote';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';

// Runtime MDX compiler for DB-stored blog posts (docs MDX is compiled at build time
// instead). Mirrors source.config.ts's processing so a post behaves like a doc,
// including remarkMdxMermaid rewriting ```mermaid fences into <Mermaid />.
const compiler = createCompiler({
  remarkPlugins: (v) => [remarkMdxMermaid, ...v],
});

export type CompiledPost = Awaited<ReturnType<typeof compilePost>>;

export const compilePost = async (source: string) => {
  const { body, toc } = await compiler.compile({ source });
  return { body, toc };
};
