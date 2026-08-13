import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Button } from '@helix-hq/design-system/components/button';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';

import { Section } from '@/components/marketing/section';
import { pillars, site } from '@/lib/site';

import type { Metadata } from 'next';

export const generateStaticParams = () => pillars.map((p) => ({ pillar: p.slug }));

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ pillar: string }>;
}): Promise<Metadata> => {
  const { pillar } = await params;
  const found = pillars.find((p) => p.slug === pillar);
  if (found === undefined) return {};
  return { title: found.name, description: found.summary };
};

const PillarPage = async ({ params }: { params: Promise<{ pillar: string }> }) => {
  const { pillar } = await params;
  const found = pillars.find((p) => p.slug === pillar);
  if (found === undefined) notFound();

  const index = pillars.findIndex((p) => p.slug === pillar);
  const next = pillars[(index + 1) % pillars.length] ?? found;

  return (
    <Section className="border-b-0">
      <Link
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        href="/product"
      >
        <ArrowLeft className="size-4" />
        All products
      </Link>

      <div className="mt-8 max-w-2xl">
        <p className="text-brand mb-3 text-xs font-medium tracking-widest uppercase">Product</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{found.name}</h1>
        <p className="text-muted-foreground mt-3 text-lg">{found.tagline}</p>
        <p className="text-muted-foreground mt-6 text-base/7">{found.summary}</p>
      </div>

      <ul className="mt-10 grid max-w-3xl gap-3 sm:grid-cols-2">
        {found.points.map((point) => (
          <li
            key={point}
            className="border-border/60 bg-card/40 flex items-start gap-3 rounded-lg border p-4"
          >
            <Check className="text-brand mt-0.5 size-4 shrink-0" />
            <span className="text-foreground text-sm">{point}</span>
          </li>
        ))}
      </ul>

      <div className="mt-12 flex flex-wrap items-center gap-3">
        <Button asChild className="h-10 px-5">
          <a href={site.appUrl} rel="noreferrer" target="_blank">
            Launch the platform
            <ArrowRight />
          </a>
        </Button>
        <Button asChild className="h-10 px-5" variant="outline">
          <Link href="/docs">Read the docs</Link>
        </Button>
      </div>

      <div className="border-border/60 mt-16 border-t pt-6">
        <Link
          className="group border-border/70 bg-card/40 hover:border-brand/50 flex items-center justify-between gap-4 rounded-xl border p-5 transition-colors"
          href={`/product/${next.slug}`}
        >
          <div>
            <p className="text-muted-foreground text-xs">Next</p>
            <p className="font-medium">{next.name}</p>
          </div>
          <ArrowRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </Section>
  );
};

export default PillarPage;
