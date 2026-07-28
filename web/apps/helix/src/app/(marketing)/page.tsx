import { ArchitectureSection } from '@/components/marketing/architecture-section';
import { EcosystemSection } from '@/components/marketing/ecosystem-section';
import { GetStartedSection } from '@/components/marketing/get-started-section';
import { Hero } from '@/components/marketing/hero';
import { LayersSection } from '@/components/marketing/layers-section';
import { OpenSourceSection } from '@/components/marketing/open-source-section';
import { OrbitSpine } from '@/components/marketing/orbit-spine';
import { ProtocolSection } from '@/components/marketing/protocol-section';
import { SectionRail } from '@/components/marketing/section-rail';
import { site } from '@/lib/site';

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: site.name,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Linux, ESP32, Android, Web',
  description: site.description,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  license: 'https://www.gnu.org/licenses/agpl-3.0.html',
};

const HomePage = () => (
  <>
    <script
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      type="application/ld+json"
    />
    <SectionRail />
    <div className="relative">
      <OrbitSpine />
      <div className="relative z-10">
        <Hero />
        <ProtocolSection />
        <LayersSection />
        <ArchitectureSection />
        <EcosystemSection />
        <OpenSourceSection />
        <GetStartedSection />
      </div>
    </div>
  </>
);

export default HomePage;
