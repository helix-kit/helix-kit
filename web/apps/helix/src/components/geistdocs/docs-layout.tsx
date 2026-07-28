import type { ComponentProps, ReactNode } from 'react';

import { DocsLayout as FumadocsDocsLayout } from 'fumadocs-ui/layouts/docs';

interface DocsLayoutProps {
  children: ReactNode;
  tree: ComponentProps<typeof FumadocsDocsLayout>['tree'];
}

// The docs route layout supplies the topbar + fixed sidebar; fumadocs only owns the page content + TOC here.
export const DocsLayout = ({ tree, children }: DocsLayoutProps) => (
  <FumadocsDocsLayout
    containerProps={{
      className: 'docs-layout bg-background',
    }}
    nav={{
      enabled: false,
    }}
    searchToggle={{
      enabled: false,
    }}
    sidebar={{
      enabled: false,
    }}
    themeSwitch={{
      enabled: false,
    }}
    tree={tree}
  >
    {children}
  </FumadocsDocsLayout>
);
