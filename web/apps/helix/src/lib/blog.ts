import { createBlogSeo } from '@helix-hq/blog/seo';

import { CodeBlock } from '@/components/geistdocs/code-block';
import { Mermaid } from '@/components/geistdocs/mermaid';

import { publicOrigin, site } from './site';

import type { MDXComponents } from 'mdx/types';

/** This app's identity, handed to the blog package's structured-data builders. */
export const blogSeo = createBlogSeo({ origin: publicOrigin, siteName: site.name });

/**
 * Renderers the blog's MDX resolves against. Reusing the geistdocs components keeps a post
 * looking like a doc; the fumadocs docs map stays confined to /docs so its theme never leaks.
 */
export const blogMdxComponents: MDXComponents = {
  pre: CodeBlock,
  Mermaid,
};
