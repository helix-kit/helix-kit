import { ToolsGrid } from './diagrams/tools-grid';
import { SectionIntro, SectionShell } from './landing-section';

export const EcosystemSection = () => (
  <SectionShell id="ecosystem">
    <div className="grid gap-10 lg:grid-cols-[0.8fr_2fr] lg:items-center lg:gap-12">
      <SectionIntro
        cta={{ label: 'Browse SDKs & Tools', href: '/product' }}
        description="From firmware to mobile to dashboards — everything speaks the same language."
        eyebrow="Tools That Speak Helix"
        title={
          <>
            One <span className="text-brand">ecosystem.</span> Every experience.
          </>
        }
      />
      <ToolsGrid />
    </div>
  </SectionShell>
);
