import { ArchitectureDiagram } from './diagrams/architecture-diagram';
import { SectionIntro, SectionShell } from './landing-section';

export const ArchitectureSection = () => (
  <SectionShell id="architecture">
    <div className="grid gap-10 lg:grid-cols-[0.8fr_2fr] lg:items-center lg:gap-12">
      <SectionIntro
        cta={{ label: 'See architecture docs', href: '/docs' }}
        description="Event-driven, horizontally scalable, and designed for edge, cloud, and everything in between."
        eyebrow="Built for Real-World IoT"
        title={
          <>
            A production-ready <span className="text-brand">architecture.</span>
          </>
        }
      />
      <ArchitectureDiagram />
    </div>
  </SectionShell>
);
