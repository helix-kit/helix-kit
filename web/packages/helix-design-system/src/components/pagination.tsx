import type * as React from 'react';

import { Button } from '@helix-hq/design-system/components/button';
import { cn } from '@helix-hq/design-system/lib/utils';
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react';

const Pagination = ({ className, ...props }: React.ComponentProps<'nav'>) => (
  <nav
    aria-label="pagination"
    className={cn('mx-auto flex w-full justify-center', className)}
    data-slot="pagination"
    role="navigation"
    {...props}
  />
);

const PaginationContent = ({ className, ...props }: React.ComponentProps<'ul'>) => (
  <ul
    className={cn('flex items-center gap-0.5', className)}
    data-slot="pagination-content"
    {...props}
  />
);

const PaginationItem = ({ ...props }: React.ComponentProps<'li'>) => (
  <li data-slot="pagination-item" {...props} />
);

type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<React.ComponentProps<typeof Button>, 'size'> &
  React.ComponentProps<'a'>;

const PaginationLink = ({
  className,
  isActive,
  size = 'icon',
  children,
  ...props
}: PaginationLinkProps) => (
  <Button
    asChild
    className={cn(className)}
    size={size}
    variant={isActive === true ? 'outline' : 'ghost'}
  >
    <a
      aria-current={isActive === true ? 'page' : undefined}
      data-active={isActive}
      data-slot="pagination-link"
      {...props}
    >
      {children}
    </a>
  </Button>
);

const PaginationPrevious = ({
  className,
  text = 'Previous',
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) => (
  <PaginationLink
    aria-label="Go to previous page"
    className={cn('pl-1.5!', className)}
    size="default"
    {...props}
  >
    <ChevronLeftIcon data-icon="inline-start" />
    <span className="hidden sm:block">{text}</span>
  </PaginationLink>
);

const PaginationNext = ({
  className,
  text = 'Next',
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) => (
  <PaginationLink
    aria-label="Go to next page"
    className={cn('pr-1.5!', className)}
    size="default"
    {...props}
  >
    <span className="hidden sm:block">{text}</span>
    <ChevronRightIcon data-icon="inline-end" />
  </PaginationLink>
);

const PaginationEllipsis = ({ className, ...props }: React.ComponentProps<'span'>) => (
  <span
    aria-hidden
    className={cn(
      "flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
    data-slot="pagination-ellipsis"
    {...props}
  >
    <MoreHorizontalIcon />
    <span className="sr-only">More pages</span>
  </span>
);

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};
