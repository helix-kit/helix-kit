import { CodeBlock } from '@/components/geistdocs/code-block';
import { Mermaid } from '@/components/geistdocs/mermaid';
import type { CompiledPost } from '@/lib/blog-mdx';

import type { MDXComponents } from 'mdx/types';

import './post-content.css';

// Blog MDX map reuses only app-local components; the fumadocs docs map is confined to /docs so its theme never leaks here.
const components: MDXComponents = {
  pre: CodeBlock,
  Mermaid,
};

export const PostContent = ({ body: Body }: { body: CompiledPost['body'] }) => (
  <div className="prose prose-zinc dark:prose-invert prose-headings:scroll-mt-24 prose-headings:font-semibold prose-a:text-brand max-w-none">
    <Body components={components} />
  </div>
);
