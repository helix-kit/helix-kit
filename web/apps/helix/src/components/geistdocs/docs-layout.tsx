import type { ComponentProps, ReactNode } from 'react';

import { DocsLayout as FumadocsDocsLayout } from 'fumadocs-ui/layouts/docs';

interface DocsLayoutProps {
  children: ReactNode;
  tree: ComponentProps<typeof FumadocsDocsLayout>['tree'];
}

// The reading chrome (topbar + fixed sidebar) is supplied by the docs route
// layout; fumadocs only owns the page content + table of contents here. The
// `docs-layout` class (see docs.css) pads the content for our fixed sidebar and
// topbar, mirroring the better-auth docs layout.
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
