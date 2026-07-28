import Link from 'next/link';

import { site } from '@/lib/site';

import { DiscordIcon, GithubIcon, TwitterIcon } from './icons';
import { Logo } from './logo';
import { ThemeToggleSegmented } from './theme-toggle-segmented';

const footerLinks = [
  { label: 'Platform', href: '/product' },
  { label: 'Docs', href: '/docs' },
  { label: 'Community', href: '/open-source' },
  { label: 'Blog', href: '/blog' },
  { label: 'License', href: '/legal' },
];

export const SiteFooter = () => (
  <footer className="border-border/60 relative z-10 border-t">
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xs">
          <Logo />
          <p className="text-muted-foreground mt-3 text-sm">{site.tagline}</p>
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {footerLinks.map((l) => (
            <Link
              key={l.href}
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
              href={l.href}
            >
              {l.label}
            </Link>
          ))}
          <a
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            href={site.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </nav>

        <div className="text-muted-foreground flex items-center gap-4">
          <a aria-label="GitHub" href={site.sourceUrl} rel="noreferrer" target="_blank">
            <GithubIcon className="hover:text-foreground size-5 transition-colors" />
          </a>
          <a aria-label="X" className="hover:text-foreground transition-colors" href="/open-source">
            <TwitterIcon className="size-5" />
          </a>
          <a
            aria-label="Discord"
            className="hover:text-foreground transition-colors"
            href="/open-source"
          >
            <DiscordIcon className="size-5" />
          </a>
        </div>
      </div>

      <div className="border-border/60 text-muted-foreground mt-10 flex flex-col gap-4 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Hardik Jain. Licensed under AGPL-3.0-only.</p>
        <div className="flex items-center gap-4">
          <p>Helix is unreleased software, built in the open.</p>
          <ThemeToggleSegmented />
        </div>
      </div>
    </div>
  </footer>
);
