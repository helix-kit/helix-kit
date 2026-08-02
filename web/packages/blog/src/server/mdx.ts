import 'server-only';

import { createCompiler } from '@fumadocs/mdx-remote';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';

// Runtime MDX compiler for DB-stored blog posts (docs MDX is compiled at build time
// instead). Mirrors source.config.ts's processing so a post behaves like a doc,
// including remarkMdxMermaid rewriting ```mermaid fences into <Mermaid />.
// Annotated rather than inferred: the inferred shape names types internal to
// @fumadocs/mdx-remote that a declaration file cannot reference (TS2883).
const compiler: ReturnType<typeof createCompiler> = createCompiler({
  remarkPlugins: (v) => [remarkMdxMermaid, ...v],
});

type CompileResult = Awaited<ReturnType<typeof compiler.compile>>;

// Written out rather than inferred: the inferred shape names types internal to
// @fumadocs/mdx-remote that a declaration file cannot reference (TS2883).
export type CompiledPost = {
  body: CompileResult['body'];
  toc: CompileResult['toc'];
};

export const compilePost = async (source: string): Promise<CompiledPost> => {
  const { body, toc } = await compiler.compile({ source });
  return { body, toc };
};
