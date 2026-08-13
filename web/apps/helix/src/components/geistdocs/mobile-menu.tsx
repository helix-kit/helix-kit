'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@helix-hq/design-system/lib/utils';

import { nav } from './config';
import { SearchButton } from './search';

const MobileMenuButton = ({ expanded, onClick }: { expanded: boolean; onClick: () => void }) => (
  <button
    aria-expanded={expanded}
    aria-label={expanded ? 'Close menu' : 'Open menu'}
    className="relative flex size-8 items-center justify-center rounded-full border border-gray-200 transition-colors hover:bg-gray-100 lg:hidden"
    type="button"
    onClick={onClick}
  >
    <span className="flex flex-col items-center justify-center gap-[5px]">
      <span
        className={cn(
          'bg-gray-1000 block h-[1.5px] w-3.5 transition-all duration-150',
          expanded && 'translate-y-[3.25px] rotate-45',
        )}
      />
      <span
        className={cn(
          'bg-gray-1000 block h-[1.5px] w-3.5 transition-all duration-150',
          expanded && '-translate-y-[3.25px] -rotate-45',
        )}
      />
    </span>
  </button>
);

export const MobileMenu = () => {
  const [show, setShow] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!show) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShow(false);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pathname, show]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && show) {
        setShow(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [show]);

  useEffect(() => {
    document.body.style.overflow = show ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [show]);

  const close = () => {
    setShow(false);
  };

  return (
    <>
      <MobileMenuButton
        expanded={show}
        onClick={() => {
          setShow(!show);
        }}
      />

      <button
        aria-label="Close menu"
        className={cn(
          'bg-background-200 fixed inset-0 top-(--landing-topbar-height) z-40 backdrop-blur-sm transition-opacity duration-200',
          show ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        type="button"
        onClick={close}
      />

      <div
        className={cn(
          'bg-background-200 fixed inset-x-0 top-(--landing-topbar-height) bottom-0 z-40 overflow-y-auto px-2 transition-all duration-200',
          show ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0',
        )}
      >
        <div className="p-4">
          <SearchButton className="w-full" onClick={close} />
        </div>

        <nav className="px-1">
          {nav.map(({ label, href }) => (
            <Link
              key={href}
              className="hover:text-gray-1000 flex items-center justify-between rounded-md p-3 text-gray-900 transition-colors hover:bg-gray-100"
              href={href}
              onClick={close}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
};
