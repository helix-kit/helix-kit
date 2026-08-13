'use client';

import Link from 'next/link';

import { Button } from '@helix-hq/design-system/components/button';
import { useQueryState, parseAsArrayOf, parseAsString } from 'nuqs';

const compareParser = parseAsArrayOf(parseAsString, ',').withDefault([]);

const useCompareSelection = () => useQueryState('compare', compareParser);

/** Stages a part for comparison. The selection lives in the URL, so it is shareable. */
export const CompareToggle = ({ slug }: { readonly slug: string }) => {
  const [selected, setSelected] = useCompareSelection();
  const active = selected.includes(slug);

  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'outline'}
      onClick={() => {
        const next = active ? selected.filter((entry) => entry !== slug) : [...selected, slug];
        void setSelected(next.length === 0 ? null : next);
      }}
    >
      {active ? 'Selected' : 'Compare'}
    </Button>
  );
};

export const CompareBar = () => {
  const [selected, setSelected] = useCompareSelection();

  if (selected.length === 0) {
    return null;
  }

  return (
    <div className="border-border bg-background/95 sticky bottom-4 z-30 flex items-center justify-between gap-4 rounded-lg border p-3 shadow-lg backdrop-blur">
      <span className="text-sm">
        {selected.length} part{selected.length === 1 ? '' : 's'} staged
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void setSelected(null);
          }}
        >
          Clear
        </Button>
        <Button asChild size="sm">
          <Link href={`/compare?slugs=${selected.join(',')}`}>Compare</Link>
        </Button>
      </div>
    </div>
  );
};
