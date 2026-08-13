'use client';

import type { ReactNode } from 'react';

import Link from 'next/link';

import { cn } from '@helix-hq/design-system/lib/utils';
import { ArrowRight } from 'lucide-react';

import { Reveal } from './motion/reveal';

export const SectionShell = ({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) => (
  <section
    className={cn('relative scroll-mt-24 px-4 py-20 sm:px-6 md:py-28 lg:px-8', className)}
    id={id}
  >
    <div className="mx-auto max-w-7xl">{children}</div>
  </section>
);

export const SectionIntro = ({
  eyebrow,
  title,
  description,
  cta,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  cta?: { label: string; href: string };
  className?: string;
}) => (
  <div className={cn('max-w-md', className)}>
    <Reveal>
      <p className="text-brand mb-4 font-mono text-xs font-medium tracking-widest uppercase">
        {eyebrow}
      </p>
    </Reveal>
    <Reveal delay={0.05}>
      <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl md:text-[2.6rem] md:leading-[1.08]">
        {title}
      </h2>
    </Reveal>
    {description != null ? (
      <Reveal delay={0.1}>
        <p className="text-muted-foreground mt-5 text-pretty">{description}</p>
      </Reveal>
    ) : null}
    {cta != null ? (
      <Reveal delay={0.15}>
        <Link
          className="text-brand mt-6 inline-flex items-center gap-1.5 text-sm font-medium transition-all hover:gap-2.5"
          href={cta.href}
        >
          {cta.label}
          <ArrowRight className="size-4" />
        </Link>
      </Reveal>
    ) : null}
  </div>
);
