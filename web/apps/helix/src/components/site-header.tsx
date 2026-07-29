'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@helix/design-system/components/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@helix/design-system/components/sheet';
import { cn } from '@helix/design-system/lib/utils';
import { Menu, Star } from 'lucide-react';

import { nav, site } from '@/lib/site';

import { GithubIcon } from './icons';
import { Logo } from './logo';

export const SiteHeader = ({ stars }: { stars?: string | null }) => {
  const pathname = usePathname();

  return (
    <header className="border-border/50 bg-background/70 sticky top-0 z-50 w-full border-b backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Logo />

        <nav className="mx-auto hidden items-center gap-1 md:flex">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                className={cn(
                  'text-muted-foreground hover:text-foreground rounded-md px-3 py-2 text-sm transition-colors',
                  active && 'text-foreground',
                )}
                href={item.href}
              >
                {item.label}
              </Link>
            );
          })}
          <a
            className="text-muted-foreground hover:text-foreground rounded-md px-3 py-2 text-sm transition-colors"
            href={site.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <a
            className="border-border/70 bg-card/40 text-foreground hover:border-brand/50 hidden items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors sm:inline-flex"
            href={site.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            <Star className="text-brand size-3.5" />
            Star
            {stars != null && stars !== '' ? (
              <span className="text-muted-foreground">{stars}</span>
            ) : null}
          </a>
          <Button
            asChild
            className="hover:shadow-brand/30 h-9 px-4 text-sm transition-shadow hover:shadow-lg"
          >
            <a href={site.appUrl} rel="noreferrer" target="_blank">
              Get Started
            </a>
          </Button>

          <Sheet>
            <SheetTrigger asChild>
              <Button aria-label="Menu" className="md:hidden" size="icon-sm" variant="outline">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent className="w-72" side="right">
              <SheetTitle className="px-1">
                <Logo />
              </SheetTitle>
              <nav className="mt-6 grid gap-1">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md px-3 py-2 text-sm"
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                ))}
                <a
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md px-3 py-2 text-sm"
                  href={site.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  GitHub
                </a>
              </nav>
              <div className="mt-6 grid gap-2 px-1">
                <Button asChild>
                  <a href={site.appUrl} rel="noreferrer" target="_blank">
                    Get Started
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href={site.sourceUrl} rel="noreferrer" target="_blank">
                    <GithubIcon />
                    View source
                  </a>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
};
