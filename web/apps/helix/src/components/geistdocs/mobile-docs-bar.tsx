'use client';

import { useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@helix/design-system/components/sheet';
import { cn } from '@helix/design-system/lib/utils';

import { useSidebarContext } from '@/hooks/geistdocs/use-sidebar';

import { IconFileText, IconMenuAlt } from './icons';

import type { TableOfContents } from 'fumadocs-core/toc';

interface MobileDocsBarProps {
  toc?: TableOfContents;
}

export const MobileDocsBar = ({ toc }: MobileDocsBarProps) => {
  const { setIsOpen: setSidebarOpen } = useSidebarContext();
  const [tocOpen, setTocOpen] = useState(false);
  const hasToc = Array.isArray(toc) && toc.length > 0;

  return (
    <div className="bg-background-100 sticky top-(--landing-topbar-height) z-30 -mx-6 -mt-6 mb-6 flex h-[54px] items-center justify-between border-b px-6 md:hidden">
      <button
        className="text-gray-1000 flex items-center gap-3 text-base"
        type="button"
        onClick={() => {
          setSidebarOpen(true);
        }}
      >
        <IconMenuAlt size={16} />
        Menu
      </button>

      {hasToc ? (
        <>
          <button
            aria-label="Table of contents"
            className="hover:text-gray-1000 flex size-8 items-center justify-center rounded-md border border-gray-200 text-gray-900 transition-colors hover:bg-gray-100"
            type="button"
            onClick={() => {
              setTocOpen(true);
            }}
          >
            <IconFileText size={16} />
          </button>

          <Sheet open={tocOpen} onOpenChange={setTocOpen}>
            <SheetContent className="w-72 gap-0" side="right">
              <SheetHeader>
                <SheetTitle className="px-4 pt-4 text-sm font-medium">On this page</SheetTitle>
                <SheetDescription className="sr-only">
                  Table of contents for the current page.
                </SheetDescription>
              </SheetHeader>
              <nav className="flex-1 overflow-y-auto px-4 pb-4">
                <ul className="space-y-1">
                  {toc.map((item) => (
                    <li key={item.url}>
                      <a
                        className={cn(
                          'hover:text-gray-1000 block rounded-md py-1.5 text-sm text-gray-900 transition-colors',
                          item.depth > 2 && 'pl-4',
                        )}
                        href={item.url}
                        onClick={() => {
                          setTocOpen(false);
                        }}
                      >
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </SheetContent>
          </Sheet>
        </>
      ) : null}
    </div>
  );
};
