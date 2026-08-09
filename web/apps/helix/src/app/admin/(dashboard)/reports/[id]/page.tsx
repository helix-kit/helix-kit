import { notFound } from 'next/navigation';

import { fetchQuery } from '@/server/server';

import TemplateWorkspace from './_components/template-workspace';

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Edit report template' };

const TemplatePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;

  const [template, conversations] = await Promise.all([
    fetchQuery((trpc) => trpc.reportTemplates.get.queryOptions({ id })).catch(() => null),
    fetchQuery((trpc) => trpc.reportConversations.list.queryOptions({ subjectId: id })),
  ]);

  if (template === null) {
    notFound();
  }

  return (
    <TemplateWorkspace
      conversations={conversations}
      // Read on the server, so a production build never ships the control.
      fixturesAvailable={process.env.NODE_ENV === 'development'}
      template={template}
    />
  );
};

export default TemplatePage;
