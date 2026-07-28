import Link from 'next/link';

import { TypeTable } from 'fumadocs-ui/components/type-table';
import defaultMdxComponents from 'fumadocs-ui/mdx';

import { Callout, CalloutContainer, CalloutDescription, CalloutTitle } from './callout';
import { CodeBlock } from './code-block';
import {
  CodeBlockTab,
  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
} from './code-block-tabs';
import { Mermaid } from './mermaid';
import { Check, Cross, Warn } from './status-icons';

import type { MDXComponents } from 'mdx/types';

export const getMDXComponents = (components?: MDXComponents): MDXComponents => ({
  ...defaultMdxComponents,

  pre: CodeBlock,

  a: ({ children, href, ...props }) => {
    const linkContent = children ?? href ?? null;

    return typeof href === 'string' && href.startsWith('/') ? (
      <Link className="text-primary font-normal no-underline" href={href} {...props}>
        {linkContent}
      </Link>
    ) : (
      <a {...props} className="text-primary font-normal no-underline" href={href}>
        {linkContent}
      </a>
    );
  },

  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
  CodeBlockTab,

  TypeTable,

  Callout,
  CalloutContainer,
  CalloutTitle,
  CalloutDescription,

  Mermaid,

  Check,
  Cross,
  Warn,

  ...components,
});
