'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@helix-hq/design-system/lib/utils';

interface DesktopMenuProps {
  className?: string;
  items: { label: string; href: string }[];
}

export const DesktopMenu = ({ items, className }: DesktopMenuProps) => {
  const pathname = usePathname();

  return (
    <nav className={cn('h-14 items-center gap-4', className)}>
      {items.map((item) => {
        const isExternal = item.href.startsWith('http');
        const isActive =
          !isExternal && (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href));

        return isExternal ? (
          <a
            key={item.href}
            className="hover:text-gray-1000 flex items-center text-sm text-gray-900 transition-colors duration-100"
            href={item.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            {item.label}
          </a>
        ) : (
          <Link
            key={item.href}
            className={cn(
              'hover:text-gray-1000 flex items-center text-sm text-gray-900 transition-colors duration-100',
              isActive && 'text-gray-1000',
            )}
            href={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
};
