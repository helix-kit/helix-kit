import { Button } from '@helix-hq/design-system/components/button';
import { Package, Scale, Server } from 'lucide-react';

import { GithubIcon } from '@/components/icons';
import { Section, SectionHeading } from '@/components/marketing/section';
import { site } from '@/lib/site';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Open source',
  description:
    'Helix is open source under AGPL-3.0. Self-host the whole stack as a single appliance, or adopt individual libraries.',
};

const cards = [
  {
    icon: Scale,
    title: 'AGPL-3.0-only',
    body: 'The software is provided under the GNU Affero General Public License v3. Inspect it, modify it, and redistribute it under that license. Docs and media are CC-BY-SA-4.0.',
  },
  {
    icon: Server,
    title: 'Self-host as an appliance',
    body: 'The entire cloud platform packages into a single Docker image you can install on your own on-premise infrastructure — lightweight and fully feature-rich.',
  },
  {
    icon: Package,
    title: 'Adopt piece by piece',
    body: 'Every layer is a library or SDK. Install just the protocol core, the backend package, or the Android SDK — compose only what your product needs.',
  },
];

const OpenSourcePage = () => (
  <>
    <Section>
      <SectionHeading
        description="Helix is an open-source project you can read, extend, and self-host. Nothing is locked away."
        eyebrow="Open source"
        title="Built in the open, yours to run"
      />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.title}
            className="border-border/70 bg-card/40 flex flex-col gap-3 rounded-xl border p-6"
          >
            <span className="border-border/70 bg-muted/50 text-brand flex size-9 items-center justify-center rounded-lg border">
              <card.icon className="size-4.5" />
            </span>
            <h3 className="text-base font-medium">{card.title}</h3>
            <p className="text-muted-foreground text-sm/6">{card.body}</p>
          </div>
        ))}
      </div>
    </Section>

    <Section className="bg-muted/20 border-b-0">
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div className="max-w-xl">
          <h2 className="text-2xl font-semibold tracking-tight">Get the source</h2>
          <p className="text-muted-foreground mt-2">
            Clone the monorepo — embedded firmware, edge OS, cloud, and clients — and start
            building.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild className="h-10 px-5">
            <a href={site.sourceUrl} rel="noreferrer" target="_blank">
              <GithubIcon />
              View on GitHub
            </a>
          </Button>
          <Button asChild className="h-10 px-5" variant="outline">
            <a href="/legal">Licensing details</a>
          </Button>
        </div>
      </div>
    </Section>
  </>
);

export default OpenSourcePage;
