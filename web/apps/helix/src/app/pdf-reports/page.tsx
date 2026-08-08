import { PdfReportEditor } from './pdf-report-editor';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PDF report templates',
  description:
    'Author and preview the JSON templates the Helix PDF report renderer turns into documents.',
  robots: { index: false, follow: false },
};

const PdfReportsPage = () => (
  <div className="mx-auto flex h-svh min-h-0 w-full max-w-[110rem] flex-col gap-6 p-4 sm:p-6">
    <PdfReportEditor />
  </div>
);

export default PdfReportsPage;
