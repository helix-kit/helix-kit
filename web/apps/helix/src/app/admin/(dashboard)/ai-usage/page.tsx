import { fetchQuery } from '@/server/server';

import { AiUsageView } from './ai-usage-view';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI usage',
  robots: { index: false, follow: false },
};

export default async function AiUsagePage() {
  const overview = await fetchQuery((trpc) => trpc.aiUsage.overview.queryOptions());

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI usage</h1>
          <p className="text-muted-foreground text-sm">
            Per-user AI spend, and who may use AI and with how many credits.
          </p>
        </div>
        <AiUsageView overview={overview} />
      </div>
    </div>
  );
}
