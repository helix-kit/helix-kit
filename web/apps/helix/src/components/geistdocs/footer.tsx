import Link from 'next/link';

import { Button } from '@helix/design-system/components/button';

import { githubUrl } from './config';
import { GithubIcon } from './icons';
import { ThemeToggle } from './theme-toggle';

interface FooterProps {
  blurb?: string;
}

export const Footer = ({
  blurb = 'Helix developer docs track the protocol core, embedded firmware, edge OS, and cloud platform.',
}: FooterProps) => (
  <footer className="border-t px-4 py-5 md:px-6">
    <div className="mx-auto flex max-w-[1448px] flex-col items-center justify-between gap-4 sm:flex-row">
      <div className="space-y-1 text-center sm:text-left">
        <p className="text-sm font-medium">Helix Developer Docs</p>
        <p className="text-muted-foreground text-sm">{blurb}</p>
        <Link
          className="text-primary text-sm"
          href={githubUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open repository
        </Link>
      </div>
      <div className="flex items-center gap-2">
        <Button asChild size="icon-sm" type="button" variant="ghost">
          <a href={githubUrl} rel="noopener noreferrer" target="_blank">
            <GithubIcon className="size-4" />
          </a>
        </Button>
        <ThemeToggle />
      </div>
    </div>
  </footer>
);
