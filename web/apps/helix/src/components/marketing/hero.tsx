'use client';

import Link from 'next/link';

import { Button } from '@helix/design-system/components/button';
import { ArrowRight, Mouse } from 'lucide-react';
import { motion } from 'motion/react';

import { GithubIcon } from '@/components/icons';
import { heroChips } from '@/lib/landing';
import { site } from '@/lib/site';

import { LiveEventStream } from './diagrams/live-event-stream';
import { StatusTerminal } from './diagrams/status-terminal';
import { iconMap } from './icon-map';
import { fadeUp } from './motion/reveal';
import { useAnimate } from './motion/use-animate';
import { StatCards } from './stat-cards';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

export const Hero = () => {
  const animate = useAnimate();
  const wrap = animate
    ? { initial: 'hidden' as const, animate: 'show' as const, variants: container }
    : {};
  const item = animate ? fadeUp : undefined;

  return (
    <section
      className="relative flex min-h-[calc(100svh-4rem)] scroll-mt-24 flex-col px-4 pt-10 pb-8 sm:px-6 lg:px-8"
      id="home"
    >
      <div className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-10 lg:grid-cols-2 lg:gap-8">
        {/* left — copy */}
        <motion.div className="max-w-xl" {...wrap}>
          <motion.div
            className="border-border/70 bg-card/40 text-muted-foreground mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
            variants={item}
          >
            <span className="bg-brand size-1.5 animate-pulse rounded-full" />
            Open source. Transport-neutral. Yours to run.
          </motion.div>

          <motion.h1
            className="font-heading text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl md:leading-[1.05]"
            variants={item}
          >
            The open IoT platform you{' '}
            <span className="from-brand-cyan via-brand to-brand-light [animation:helix-shimmer_6s_linear_infinite] bg-gradient-to-r bg-[length:200%_100%] bg-clip-text text-transparent motion-reduce:[animation:none]">
              compose
            </span>{' '}
            yourself
          </motion.h1>

          <motion.p
            className="text-muted-foreground mt-6 max-w-lg text-lg/8 text-pretty"
            variants={item}
          >
            Helix is a modular IoT platform with a transport-neutral protocol that runs everywhere —
            from tiny MCUs to the cloud. Install the full stack as a self-hosted appliance or adopt
            the pieces your product needs.
          </motion.p>

          <motion.div className="mt-8 flex flex-col gap-3 sm:flex-row" variants={item}>
            <Button
              asChild
              className="hover:shadow-brand/30 h-11 px-6 text-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
            >
              <a href={site.appUrl} rel="noreferrer" target="_blank">
                Get Started
                <ArrowRight />
              </a>
            </Button>
            <Button
              asChild
              className="hover:border-brand/50 h-11 px-6 text-sm transition-all hover:-translate-y-0.5"
              variant="outline"
            >
              <Link href="/product">Explore the Platform</Link>
            </Button>
          </motion.div>

          <motion.div
            className="text-muted-foreground mt-10 flex flex-wrap gap-2 text-xs"
            variants={item}
          >
            {heroChips.map((chip) => {
              const Icon = iconMap[chip.icon] ?? GithubIcon;
              return (
                <span
                  key={chip.label}
                  className="border-border/60 bg-card/30 hover:border-brand/40 hover:text-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 transition-colors"
                >
                  <Icon className="text-brand size-3.5" />
                  {chip.label}
                </span>
              );
            })}
          </motion.div>
        </motion.div>

        {/* right — live panels */}
        <div className="grid gap-4 lg:pl-6">
          <StatusTerminal />
          <StatCards />
          <LiveEventStream />
        </div>
      </div>

      <div className="text-muted-foreground/60 mt-8 flex shrink-0 flex-col items-center gap-2">
        <Mouse className="size-5" />
        <span className="font-mono text-[10px] tracking-widest uppercase">Scroll to explore</span>
      </div>
    </section>
  );
};
