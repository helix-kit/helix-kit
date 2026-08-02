import { cn } from '@helix/design-system/lib/utils';

import type { TOCItemType } from 'fumadocs-core/toc';

// `toc` comes from the MDX compiler; depth 2 is a section, 3 a subsection.
export const TableOfContents = ({ toc }: { toc: TOCItemType[] }) => {
  if (toc.length === 0) return null;
  return (
    <nav aria-label="Table of contents" className="grid gap-2 text-sm">
      <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
        On this page
      </p>
      <ul className="border-border/60 grid gap-1.5 border-l">
        {toc.map((item) => (
          <li key={item.url}>
            <a
              className={cn(
                'text-muted-foreground hover:border-brand hover:text-foreground -ml-px block border-l border-transparent py-0.5 pl-3 transition-colors',
                item.depth >= 3 && 'pl-6',
              )}
              href={item.url}
            >
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
};
