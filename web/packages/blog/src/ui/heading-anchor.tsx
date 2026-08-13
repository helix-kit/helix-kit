'use client';

import { cn } from '@helix-hq/design-system/lib/utils';
import { Check, Link2 } from 'lucide-react';

import { useCopyLink } from './use-copy-link';

/** The "#" beside a section heading: jumps to the section and copies its permalink. */
export const HeadingAnchor = ({ id }: { id: string }) => {
  const { copied, copy } = useCopyLink();

  return (
    <a
      aria-label="Copy link to this section"
      className={cn(
        'text-muted-foreground/60 hover:text-brand ml-2 inline-flex size-6 -translate-y-0.5 items-center justify-center rounded-md align-middle no-underline transition-opacity',
        'md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100',
        copied && 'text-brand md:opacity-100',
      )}
      href={`#${id}`}
      title={copied ? 'Link copied' : 'Copy link to this section'}
      onClick={() => {
        copy(`${window.location.origin}${window.location.pathname}#${id}`);
      }}
    >
      {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
    </a>
  );
};
