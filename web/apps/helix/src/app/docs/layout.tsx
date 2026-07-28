import './docs.css';

import type { ReactNode } from 'react';

import { DocsLayout } from '@/components/geistdocs/docs-layout';
import { DocsSidebar } from '@/components/geistdocs/docs-sidebar';
import { Navbar } from '@/components/geistdocs/navbar';
import { GeistdocsProvider } from '@/components/geistdocs/provider';
import { source } from '@/lib/source';

const Layout = ({ children }: { children: ReactNode }) => (
  <div className="bg-background">
    <GeistdocsProvider>
      <Navbar />
      <DocsSidebar />
      <DocsLayout tree={source.pageTree}>{children}</DocsLayout>
    </GeistdocsProvider>
  </div>
);

export default Layout;
