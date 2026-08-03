import Link from 'next/link';

import { Button } from '@helix/design-system/components/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Page links rather than client-side state: a page of a catalog is a thing you should be able
 * to link someone to, and the list pages are server-rendered anyway.
 */

const PAGE_WINDOW = 2;

const buildHref = (basePath: string, params: Record<string, string | undefined>, page: number) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '' && key !== 'page') {
      query.set(key, value);
    }
  }
  if (page > 1) {
    query.set('page', String(page));
  }
  const suffix = query.toString();
  return suffix === '' ? basePath : `${basePath}?${suffix}`;
};

/** Current page ± a window, always including the first and last, with gaps collapsed. */
const pageNumbers = (page: number, pageCount: number): (number | 'gap')[] => {
  const wanted = new Set<number>([1, pageCount]);
  for (let offset = -PAGE_WINDOW; offset <= PAGE_WINDOW; offset += 1) {
    const candidate = page + offset;
    if (candidate >= 1 && candidate <= pageCount) {
      wanted.add(candidate);
    }
  }

  const sorted = [...wanted].sort((left, right) => left - right);
  const withGaps: (number | 'gap')[] = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous !== 0 && value - previous > 1) {
      withGaps.push('gap');
    }
    withGaps.push(value);
    previous = value;
  }
  return withGaps;
};

export const Pagination = ({
  page,
  perPage,
  total,
  basePath,
  params,
  unit = 'entries',
}: {
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly basePath: string;
  /** The current query string, so filters and search survive a page change. */
  readonly params: Record<string, string | undefined>;
  readonly unit?: string;
}) => {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  return (
    <nav aria-label="pagination" className="flex flex-wrap items-center justify-between gap-3 pt-2">
      <span className="text-muted-foreground text-sm">
        {total === 0 ? `No ${unit}` : `${first}–${last} of ${total} ${unit}`}
      </span>

      {pageCount <= 1 ? null : (
        <div className="flex items-center gap-1">
          <Button asChild={page > 1} disabled={page <= 1} size="icon" variant="ghost">
            {page > 1 ? (
              <Link aria-label="Previous page" href={buildHref(basePath, params, page - 1)}>
                <ChevronLeft />
              </Link>
            ) : (
              <span aria-hidden>
                <ChevronLeft />
              </span>
            )}
          </Button>

          {pageNumbers(page, pageCount).map((entry, index) =>
            entry === 'gap' ? (
              // eslint-disable-next-line react/no-array-index-key -- gaps have no identity of their own
              <span key={`gap-${index}`} className="text-muted-foreground px-1 text-sm">
                …
              </span>
            ) : (
              <Button
                key={entry}
                asChild
                size="icon"
                variant={entry === page ? 'outline' : 'ghost'}
              >
                <Link
                  aria-current={entry === page ? 'page' : undefined}
                  href={buildHref(basePath, params, entry)}
                >
                  {entry}
                </Link>
              </Button>
            ),
          )}

          <Button
            asChild={page < pageCount}
            disabled={page >= pageCount}
            size="icon"
            variant="ghost"
          >
            {page < pageCount ? (
              <Link aria-label="Next page" href={buildHref(basePath, params, page + 1)}>
                <ChevronRight />
              </Link>
            ) : (
              <span aria-hidden>
                <ChevronRight />
              </span>
            )}
          </Button>
        </div>
      )}
    </nav>
  );
};
