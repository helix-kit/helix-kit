import { CodeBlock } from '@/components/geistdocs/code-block';
import { Mermaid } from '@/components/geistdocs/mermaid';
import type { CompiledPost } from '@/lib/blog-mdx';

import type { MDXComponents } from 'mdx/types';

import './post-content.css';

// MDX component map for blog posts.
//
// The docs map (components/geistdocs/mdx-components.tsx) pulls in
// `fumadocs-ui/mdx` + TypeTable, which are styled by fumadocs-ui/css/preset.css
// — and that stylesheet is deliberately confined to the /docs route group so the
// Geist docs theme never leaks into the marketing site. The blog therefore reuses
// only the app-local, portable components (CodeBlock and Mermaid depend on the
// design system alone) and lets Tailwind `prose` style the plain GFM elements.
const components: MDXComponents = {
  pre: CodeBlock,
  Mermaid,
};

export const PostContent = ({ body: Body }: { body: CompiledPost['body'] }) => (
  <div className="prose prose-zinc dark:prose-invert prose-headings:scroll-mt-24 prose-headings:font-semibold prose-a:text-brand max-w-none">
    <Body components={components} />
  </div>
);
