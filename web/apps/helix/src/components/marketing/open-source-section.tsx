import { CommunityChat } from './diagrams/community-chat';
import { GitLogTerminal } from './diagrams/git-log-terminal';
import { SectionIntro, SectionShell } from './landing-section';

export const OpenSourceSection = () => (
  <SectionShell id="open-source">
    <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr_1fr] lg:items-center">
      <SectionIntro
        cta={{ label: 'Read the license', href: '/legal' }}
        description="Helix is open source under AGPL-3.0. Docs and media are CC-BY-SA-4.0."
        eyebrow="Open by Default"
        title={
          <>
            Open source. <span className="text-brand">Open future.</span>
          </>
        }
      />
      <GitLogTerminal />
      <CommunityChat />
    </div>
  </SectionShell>
);
