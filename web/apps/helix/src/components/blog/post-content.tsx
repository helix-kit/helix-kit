import { cn } from '@helix/design-system/lib/utils';

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

const prose = cn(
  'prose prose-zinc dark:prose-invert max-w-none',
  'prose-lg prose-p:leading-8 prose-li:leading-8 prose-p:text-foreground/90',
  'prose-headings:scroll-mt-24 prose-headings:font-semibold prose-headings:tracking-tight',
  'prose-h2:mt-14 prose-h2:mb-5 prose-h2:text-2xl prose-h3:mt-10 prose-h3:mb-3 prose-h3:text-xl',
  'prose-a:text-brand prose-a:font-normal prose-a:underline-offset-4 hover:prose-a:underline',
  // Inline code as a subtle pill, no typography backticks.
  'prose-code:rounded-md prose-code:border prose-code:border-border/60 prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.9em] prose-code:font-normal prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none',
  'prose-img:rounded-xl prose-img:border prose-img:border-border/60',
  'prose-blockquote:border-brand prose-blockquote:font-normal prose-blockquote:not-italic prose-blockquote:text-muted-foreground',
);

export const PostContent = ({ body: Body }: { body: CompiledPost['body'] }) => (
  <div className={prose}>
    <Body components={components} />
  </div>
);
