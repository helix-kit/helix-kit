'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@helix-hq/design-system/components/sheet';
import { cn } from '@helix-hq/design-system/lib/utils';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { ChevronDownIcon } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';

import { useSidebarContext } from '@/hooks/geistdocs/use-sidebar';

import { githubUrl } from './config';
import { GithubIcon } from './icons';
import { buildSections, type DocsSection } from './sidebar-content';
import { ThemeToggle } from './theme-toggle';

import type * as PageTree from 'fumadocs-core/page-tree';

const HELIX_VERSION = 'v0.1.0';

const isItemActive = (pathname: string, href: string) =>
  pathname === href || (href !== '/docs' && pathname.startsWith(`${href}/`));

const getDefaultOpen = (contents: DocsSection[], pathname: string): number => {
  const index = contents.findIndex((section) =>
    section.list.some((item) => isItemActive(pathname, item.href)),
  );
  return index === -1 ? 0 : index;
};

const VersionRow = () => (
  <div className="border-foreground/5 flex items-center gap-2 border-b px-4 py-[9px]">
    <svg
      className="text-foreground size-4 shrink-0 opacity-55"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d="M7 8.25a2.75 2.75 0 1 0 0-5.5a2.75 2.75 0 0 0 0 5.5m0 0V12m0 3.75a2.75 2.75 0 1 0 0 5.5a2.75 2.75 0 0 0 0-5.5m0 0V12m10-3.75a2.75 2.75 0 1 0 0-5.5a2.75 2.75 0 0 0 0 5.5m0 0V9a3 3 0 0 1-3 3H7" />
    </svg>
    <span className="text-foreground/70 truncate text-sm">{HELIX_VERSION}</span>
    <span className="border-foreground/20 text-foreground/45 border border-dashed px-1.5 py-0.5 font-mono text-[9px] tracking-wider uppercase">
      Latest
    </span>
  </div>
);

const SearchRow = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { setOpenSearch } = useSearchContext();

  return (
    <button
      className="group/search text-foreground/55 hover:text-foreground/80 hover:bg-foreground/[0.03] border-foreground/5 flex w-full items-center gap-2 border-b px-4 py-[9px] text-sm transition-colors"
      type="button"
      onClick={() => {
        setOpenSearch(true);
        onNavigate?.();
      }}
    >
      <svg
        className="text-foreground size-4 shrink-0 opacity-55 transition-opacity group-hover/search:opacity-80"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
      >
        <circle cx="11" cy="11" r="5.5" />
        <path d="m15 15l4 4" />
      </svg>
      <span className="truncate">Search</span>
      <kbd className="border-foreground/10 text-foreground/40 ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-md border px-1.5 py-0.5 font-mono text-[10px]">
        <span className="text-[11px]">⌘</span>K
      </kbd>
    </button>
  );
};

const SidebarSection = ({
  section,
  pathname,
  onNavigate,
}: {
  section: DocsSection;
  pathname: string;
  onNavigate?: () => void;
}) => (
  <div className="pt-0 pb-1">
    {section.list.map((item) => {
      const active = isItemActive(pathname, item.href);
      const Icon = item.icon;
      return (
        <Link
          key={item.href}
          className={cn(
            'relative flex w-full items-center gap-2.5 px-4 py-1 text-[14px] transition-all duration-150',
            active
              ? 'text-foreground bg-foreground/[0.06]'
              : 'text-foreground/65 hover:text-foreground/90 hover:bg-foreground/[0.03]',
          )}
          data-active={active || undefined}
          href={item.href}
          onClick={onNavigate}
        >
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center transition-colors duration-150 [&>svg]:size-[14px]',
              active ? 'text-foreground' : 'text-foreground/65',
            )}
          >
            <Icon />
          </span>
          <span className="min-w-0 grow truncate">{item.title}</span>
        </Link>
      );
    })}
  </div>
);

const SidebarFooter = () => (
  <div className="border-foreground/5 text-foreground/40 flex items-center gap-1 border-t p-2">
    <a
      aria-label="GitHub"
      className="hover:text-foreground/70 hover:bg-foreground/5 inline-flex size-8 items-center justify-center transition-colors"
      href={githubUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      <GithubIcon className="size-4" />
    </a>
    <div className="[&_button]:text-foreground/40 [&_button:hover]:text-foreground/70 ms-auto">
      <ThemeToggle />
    </div>
  </div>
);

const SidebarBody = ({
  contents,
  onNavigate,
}: {
  contents: DocsSection[];
  onNavigate?: () => void;
}) => {
  const pathname = usePathname();
  const [currentOpen, setCurrentOpen] = useState(() => getDefaultOpen(contents, pathname));
  const [trackedPath, setTrackedPath] = useState(pathname);
  const navRef = useRef<HTMLElement>(null);

  // Re-open the active section on navigation via the "adjust state during render" pattern.
  if (pathname !== trackedPath) {
    setTrackedPath(pathname);
    setCurrentOpen(getDefaultOpen(contents, pathname));
  }

  return (
    <>
      <VersionRow />
      <SearchRow onNavigate={onNavigate} />
      <nav
        ref={navRef}
        className="sidebar-scroll flex-1 overflow-x-hidden overflow-y-auto pb-3"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent, white 1rem, white calc(100% - 2rem), transparent 100%)',
        }}
      >
        <MotionConfig transition={{ duration: 0.35, type: 'spring', bounce: 0 }}>
          <div className="flex flex-col">
            {contents.map((section, index) => {
              const { Icon } = section;
              const open = currentOpen === index;
              return (
                <div key={section.title}>
                  <button
                    className={cn(
                      'border-foreground/[0.06] flex w-full items-center gap-2 border-b px-4 py-2.5 text-left text-sm font-medium tracking-wider transition-colors',
                      open
                        ? 'text-foreground bg-foreground/[0.03]'
                        : 'text-foreground/70 hover:text-foreground hover:bg-foreground/[0.03]',
                    )}
                    type="button"
                    onClick={() => {
                      setCurrentOpen((prev) => (prev === index ? -1 : index));
                    }}
                  >
                    <Icon className="size-[18px]" />
                    <span className="grow tracking-normal">{section.title}</span>
                    <ChevronDownIcon
                      className={cn(
                        'text-muted-foreground size-4 shrink-0 transition-transform duration-200',
                        open && 'rotate-180',
                      )}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {open ? (
                      <motion.div
                        animate={{ opacity: 1, height: 'auto' }}
                        className="relative overflow-hidden"
                        exit={{ opacity: 0, height: 0 }}
                        initial={{ opacity: 0, height: 0 }}
                      >
                        <div className="text-sm">
                          <SidebarSection
                            pathname={pathname}
                            section={section}
                            onNavigate={onNavigate}
                          />
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </MotionConfig>
      </nav>
      <SidebarFooter />
    </>
  );
};

export const DocsSidebar = ({ tree }: { tree: PageTree.Root }) => {
  // Built here, not in the server layout: the section icons are component
  // functions, which cannot be serialised across the RSC boundary.
  const contents = useMemo(() => buildSections(tree), [tree]);
  const { isOpen, setIsOpen } = useSidebarContext();
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (pathname !== previousPathname.current) {
      setIsOpen(false);
      previousPathname.current = pathname;
    }
  }, [pathname, setIsOpen]);

  return (
    <>
      <aside className="bg-background border-foreground/5 fixed top-(--landing-topbar-height) bottom-0 left-0 z-30 hidden w-[22vw] max-w-[300px] flex-col border-r lg:flex">
        <SidebarBody contents={contents} />
      </aside>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent className="w-[300px] gap-0 p-0" side="left">
          <SheetHeader className="sr-only">
            <SheetTitle>Documentation menu</SheetTitle>
            <SheetDescription>Navigation for the documentation.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full flex-col pt-6">
            <SidebarBody
              contents={contents}
              onNavigate={() => {
                setIsOpen(false);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
