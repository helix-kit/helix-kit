import Link from 'next/link';

import { Button } from '@helix/design-system/components/button';

import { HelixMark } from '@/components/logo';

import { githubUrl, nav } from './config';
import { DesktopMenu } from './desktop-menu';
import { GithubIcon } from './icons';
import { MobileMenu } from './mobile-menu';
import { SearchButton } from './search';
import { ThemeToggle } from './theme-toggle';

export const Navbar = () => (
  <header className="bg-background border-foreground/5 fixed inset-x-0 top-0 z-40 flex h-(--landing-topbar-height) items-center border-b">
    {/* Brand — occupies the left pane, aligned above the sidebar. */}
    <div className="flex h-full items-center px-4 select-none lg:w-[22vw] lg:max-w-[300px]">
      <Link
        className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
        href="/"
      >
        <span className="text-brand">
          <HelixMark className="size-5" />
        </span>
        Helix Docs
      </Link>
    </div>
    {/* Nav + actions occupy the content pane. */}
    <div className="flex h-full flex-1 items-center px-4">
      <DesktopMenu className="hidden lg:flex" items={nav} />
      <div className="ms-auto flex flex-row items-center gap-1">
        <SearchButton className="hidden lg:flex" />
        <Button asChild size="icon-sm" type="button" variant="ghost">
          <a href={githubUrl} rel="noopener noreferrer" target="_blank">
            <GithubIcon className="size-4" />
          </a>
        </Button>
        <ThemeToggle />
        <MobileMenu />
      </div>
    </div>
  </header>
);
