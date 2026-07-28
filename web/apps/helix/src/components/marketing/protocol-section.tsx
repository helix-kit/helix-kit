'use client';

import Link from 'next/link';

import { ArrowRight, Check } from 'lucide-react';

import { protocolBullets } from '@/lib/landing';

import { ProtocolDiagram } from './diagrams/protocol-diagram';
import { SectionShell } from './landing-section';
import { Reveal, Stagger, StaggerItem } from './motion/reveal';

export const ProtocolSection = () => (
  <SectionShell id="protocol">
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
      <div className="max-w-md">
        <Reveal>
          <p className="text-brand mb-4 font-mono text-xs font-medium tracking-widest uppercase">
            One Protocol
          </p>
        </Reveal>
        <Reveal delay={0.05}>
          <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl md:text-[2.6rem] md:leading-[1.08]">
            One protocol. Every device. <span className="text-brand">Any transport.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="text-muted-foreground mt-5 text-pretty">
            Helix abstracts BLE, Serial, MQTT, and WebSockets behind a single typed request/response
            + query/mutation surface.
          </p>
        </Reveal>

        <Stagger className="mt-6 grid gap-3" stagger={0.1}>
          {protocolBullets.map((b) => (
            <StaggerItem key={b} className="flex items-start gap-3">
              <span className="border-brand/40 bg-brand/10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border">
                <Check className="text-brand size-3" />
              </span>
              <span className="text-muted-foreground text-sm">{b}</span>
            </StaggerItem>
          ))}
        </Stagger>

        <Reveal delay={0.15}>
          <Link
            className="text-brand mt-7 inline-flex items-center gap-1.5 text-sm font-medium transition-all hover:gap-2.5"
            href="/docs"
          >
            Learn about the protocol
            <ArrowRight className="size-4" />
          </Link>
        </Reveal>
      </div>

      <ProtocolDiagram />
    </div>
  </SectionShell>
);
