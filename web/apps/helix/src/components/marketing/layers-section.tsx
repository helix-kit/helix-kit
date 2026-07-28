import { LayersAccordion } from './diagrams/layers-accordion';
import { SectionIntro, SectionShell } from './landing-section';

export const LayersSection = () => (
  <SectionShell id="layers">
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
      <SectionIntro
        cta={{ label: 'Explore all layers', href: '/product' }}
        description="Each layer is a library, service, or SDK. Use the full stack or just the ones you need."
        eyebrow="Five Composable Layers"
        title={
          <>
            Assemble the stack <span className="text-brand">you need.</span>
          </>
        }
      />
      <LayersAccordion />
    </div>
  </SectionShell>
);
