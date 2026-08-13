'use client';

import type { SVGProps } from 'react';

import { cn } from '@helix-hq/design-system/lib/utils';
import { Check, Link2 } from 'lucide-react';

import { useCopyLink } from './use-copy-link';

const XIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden fill="currentColor" viewBox="0 0 24 24" {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const HackerNewsIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden fill="currentColor" viewBox="0 0 24 24" {...props}>
    <path
      d="M3.5 0h17A3.5 3.5 0 0 1 24 3.5v17a3.5 3.5 0 0 1-3.5 3.5h-17A3.5 3.5 0 0 1 0 20.5v-17A3.5 3.5 0 0 1 3.5 0m3.451 5.896 4.112 7.708v5.064h1.583v-4.972l4.148-7.8h-1.749l-2.457 4.875c-.372.745-.688 1.434-.688 1.434s-.297-.708-.651-1.434L8.831 5.896z"
      fillRule="evenodd"
    />
  </svg>
);

const LinkedInIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden fill="currentColor" viewBox="0 0 24 24" {...props}>
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125m1.782 13.019H3.555V9h3.564zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0" />
  </svg>
);

const railItem =
  'border-border/60 bg-card/30 text-muted-foreground hover:border-brand/60 hover:text-foreground inline-flex size-9 items-center justify-center rounded-full border transition-colors';

/**
 * The rail beside a post that points readers at the places it can be discussed. Host-agnostic:
 * the canonical `url` is passed in rather than derived, so the package never assumes an origin.
 */
export const PostShare = ({
  url,
  title,
  className,
}: {
  url: string;
  title: string;
  className?: string;
}) => {
  const { copied, copy } = useCopyLink();
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const links = [
    {
      label: 'Discuss on X',
      href: `https://x.com/intent/post?text=${encodedTitle}&url=${encodedUrl}`,
      Icon: XIcon,
    },
    {
      label: 'Submit to Hacker News',
      href: `https://news.ycombinator.com/submitlink?u=${encodedUrl}&t=${encodedTitle}`,
      Icon: HackerNewsIcon,
    },
    {
      label: 'Share on LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
      Icon: LinkedInIcon,
    },
  ];

  return (
    <div className={cn('flex flex-row items-center gap-2 lg:flex-col lg:items-start', className)}>
      <p className="text-muted-foreground mr-1 text-[0.65rem] font-medium tracking-widest uppercase lg:mr-0 lg:mb-1">
        Discuss
      </p>
      {links.map(({ label, href, Icon }) => (
        <a
          key={href}
          aria-label={label}
          className={railItem}
          href={href}
          rel="noreferrer"
          target="_blank"
          title={label}
        >
          <Icon className="size-4" />
        </a>
      ))}
      <button
        aria-label="Copy link to this post"
        className={cn(railItem, copied && 'border-brand/60 text-brand')}
        title={copied ? 'Link copied' : 'Copy link to this post'}
        type="button"
        onClick={() => {
          copy(url);
        }}
      >
        {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
      </button>
    </div>
  );
};
