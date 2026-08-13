'use client';

import { useEffect, useState } from 'react';

import { cn } from '@helix-hq/design-system/lib/utils';

import type { TOCItemType } from 'fumadocs-core/toc';

// Highlights the heading nearest the top of the reading area. The bottom inset keeps a heading
// "active" until the next one reaches the top, instead of flickering across the whole viewport.
const useActiveHeading = (ids: string[]) => {
  const [active, setActive] = useState('');
  const key = ids.join(',');

  useEffect(() => {
    const headings = ids.map((id) => document.getElementById(id)).filter((el) => el !== null);
    if (headings.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = ids.find((id) => visible.has(id));
        if (first !== undefined) setActive(first);
      },
      { rootMargin: '-88px 0px -70% 0px' },
    );
    headings.forEach((el) => {
      observer.observe(el);
    });
    return () => {
      observer.disconnect();
    };
    // `ids` is rebuilt on every render; `key` is its stable value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
};

// `toc` comes from the MDX compiler; depth 2 is a section, 3 a subsection.
export const TableOfContents = ({ toc }: { toc: TOCItemType[] }) => {
  const active = useActiveHeading(toc.map((item) => item.url.replace('#', '')));

  if (toc.length === 0) return null;
  return (
    <nav
      aria-label="Table of contents"
      className="grid max-h-[calc(100svh-8rem)] grid-rows-[auto_minmax(0,1fr)] gap-2 text-sm"
    >
      <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
        On this page
      </p>
      <ul className="border-border/60 grid gap-1.5 overflow-y-auto border-l">
        {toc.map((item) => {
          const id = item.url.replace('#', '');
          return (
            <li key={item.url}>
              <a
                aria-current={active === id ? 'location' : undefined}
                className={cn(
                  'text-muted-foreground hover:border-brand hover:text-foreground -ml-px block border-l border-transparent py-0.5 pl-3 transition-colors',
                  item.depth >= 3 && 'pl-6',
                  active === id && 'border-brand text-foreground',
                )}
                href={item.url}
              >
                {item.title}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
