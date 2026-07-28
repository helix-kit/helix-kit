import { notFound } from 'next/navigation';

import { Separator } from '@helix/design-system/components/separator';
import { createRelativeLink } from 'fumadocs-ui/mdx';

import { DocsBody, DocsDescription, DocsPage, DocsTitle } from '@/components/geistdocs/docs-page';
import { getMDXComponents } from '@/components/geistdocs/mdx-components';
import { MobileDocsBar } from '@/components/geistdocs/mobile-docs-bar';
import { ScrollTop } from '@/components/geistdocs/scroll-top';
import { source } from '@/lib/source';

import type { Metadata } from 'next';

const Page = async ({ params }: PageProps<'/docs/[[...slug]]'>) => {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (page == null) {
    notFound();
  }

  const PageContent = page.data.body;

  return (
    <DocsPage
      full={page.data.full}
      tableOfContent={{
        style: 'clerk',
        footer: (
          <div className="my-3 space-y-3">
            <Separator />
            <ScrollTop />
          </div>
        ),
      }}
      tableOfContentPopover={{ enabled: false }}
      toc={page.data.toc}
    >
      <MobileDocsBar toc={page.data.toc} />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <PageContent
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
};

export const generateStaticParams = () => source.generateParams();

export const generateMetadata = async ({
  params,
}: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> => {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (page == null) {
    notFound();
  }

  return {
    title: page.data.title,
    description: page.data.description,
  };
};

export default Page;
