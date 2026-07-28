import Link from 'next/link';

import { ArrowUpRight } from 'lucide-react';

import { Section, SectionHeading } from '@/components/marketing/section';
import { pillars } from '@/lib/site';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Product',
  description: 'The five composable layers of the Helix IoT platform.',
};

const ProductPage = () => (
  <Section className="border-b-0">
    <SectionHeading
      description="Each layer is independently adoptable. Explore how they fit together — or drop in just the one you need."
      eyebrow="Product"
      title="Everything Helix, layer by layer"
    />
    <div className="mt-12 grid gap-4 md:grid-cols-2">
      {pillars.map((pillar) => (
        <Link
          key={pillar.slug}
          className="group border-border/70 bg-card/40 hover:border-brand/50 hover:bg-card flex flex-col gap-3 rounded-xl border p-6 transition-colors"
          href={`/product/${pillar.slug}`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">{pillar.name}</h2>
            <ArrowUpRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
          <p className="text-muted-foreground text-sm">{pillar.summary}</p>
        </Link>
      ))}
    </div>
  </Section>
);

export default ProductPage;
