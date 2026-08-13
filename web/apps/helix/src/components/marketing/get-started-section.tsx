import { Button } from '@helix-hq/design-system/components/button';
import { ArrowRight } from 'lucide-react';

import { GithubIcon } from '@/components/icons';
import { site } from '@/lib/site';

import { CloneTerminal } from './diagrams/clone-terminal';
import { DeviceMesh } from './diagrams/device-mesh';
import { SectionShell } from './landing-section';
import { Reveal } from './motion/reveal';

export const GetStartedSection = () => (
  <SectionShell id="get-started">
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
      <div className="max-w-md">
        <Reveal>
          <p className="text-brand mb-4 font-mono text-xs font-medium tracking-widest uppercase">
            Get Started
          </p>
        </Reveal>
        <Reveal delay={0.05}>
          <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl md:text-[2.6rem] md:leading-[1.08]">
            Clone. Compose. <span className="text-brand">Connect.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="text-muted-foreground mt-5 text-pretty">
            Spin up the full stack in minutes or integrate a single SDK. The choice is yours.
          </p>
        </Reveal>
        <Reveal className="mt-6" delay={0.15}>
          <CloneTerminal />
        </Reveal>
        <Reveal className="mt-6 flex flex-col gap-3 sm:flex-row" delay={0.2}>
          <Button
            asChild
            className="hover:shadow-brand/30 h-11 px-6 text-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
          >
            <a href={site.appUrl} rel="noreferrer" target="_blank">
              Get Started
              <ArrowRight />
            </a>
          </Button>
          <Button asChild className="h-11 px-6 text-sm" variant="outline">
            <a href={site.sourceUrl} rel="noreferrer" target="_blank">
              <GithubIcon />
              View on GitHub
            </a>
          </Button>
        </Reveal>
      </div>

      <DeviceMesh />
    </div>
  </SectionShell>
);
