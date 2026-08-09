import { createLoader, type SearchParams } from 'nuqs/server';

import { fetchQuery } from '@/server/server';

import TemplatesTable from './_components/templates-table';
import { reportTemplateSearchParsers } from './search-params';

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Report templates' };

const loadSearch = createLoader(reportTemplateSearchParsers);

const ReportTemplatesPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const params = await loadSearch(searchParams);
  const data = await fetchQuery((trpc) => trpc.reportTemplates.list.queryOptions(params));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Report templates</h1>
        <p className="text-muted-foreground text-sm">
          The documents the platform can generate. A template says what data it is handed, how that
          becomes display values, and where they are drawn.
        </p>
      </div>
      <TemplatesTable pageCount={data.pageCount} rows={data.rows} />
    </div>
  );
};

export default ReportTemplatesPage;
