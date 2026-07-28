import 'server-only';

import { createCompiler } from '@fumadocs/mdx-remote';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';

// Runtime MDX compiler for DB-stored blog posts.
//
// Docs MDX is compiled at BUILD time from files under content/docs by
// fumadocs-mdx (see source.config.ts). Blog posts live in Postgres, so their
// MDX is compiled per request instead — the route's `revalidate` keeps that off
// the hot path.
//
// The `fumadocs` preset gives the same content processing as /docs: GFM,
// heading ids + TOC extraction, and shiki code highlighting. remarkMdxMermaid
// rewrites ```mermaid fences into the <Mermaid /> component, mirroring
// source.config.ts so a diagram authored in a post behaves like one in the docs.
const compiler = createCompiler({
  remarkPlugins: (v) => [remarkMdxMermaid, ...v],
});

export type CompiledPost = Awaited<ReturnType<typeof compilePost>>;

export const compilePost = async (source: string) => {
  const { body, toc } = await compiler.compile({ source });
  return { body, toc };
};
