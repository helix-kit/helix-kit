import { Section } from '@/components/marketing/section';
import { site } from '@/lib/site';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Legal',
  description: 'Licensing and legal information for Helix.',
};

const LegalPage = () => (
  <Section className="border-b-0">
    <div className="text-foreground grid max-w-3xl gap-8">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Helix legal information</h1>
        <p className="text-muted-foreground text-sm">
          Copyright © {new Date().getFullYear()} Hardik Jain
        </p>
      </header>

      <section className="border-border/60 grid gap-3 border-t pt-6">
        <h2 className="text-lg font-medium">Software license</h2>
        <p className="text-muted-foreground leading-7">
          Helix software is provided under the GNU Affero General Public License, version 3 only,
          without warranty. You may inspect, modify, and redistribute it under that license.
        </p>
        <a
          className="text-brand w-fit underline-offset-4 hover:underline"
          href={site.sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          View corresponding source code
        </a>
      </section>

      <section className="border-border/60 grid gap-3 border-t pt-6">
        <h2 className="text-lg font-medium">Documentation</h2>
        <p className="text-muted-foreground leading-7">
          Original documentation and non-code media are licensed under Creative Commons
          Attribution-ShareAlike 4.0 unless otherwise stated.
        </p>
      </section>

      <section className="border-border/60 grid gap-3 border-t pt-6">
        <h2 className="text-lg font-medium">Trademarks</h2>
        <p className="text-muted-foreground leading-7">
          &ldquo;Helix&rdquo; and the Helix logo are trademarks. The AGPL license does not grant
          permission to use them except as required for reasonable and customary use in describing
          the origin of the software.
        </p>
      </section>
    </div>
  </Section>
);

export default LegalPage;
