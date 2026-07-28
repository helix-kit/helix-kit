import { SiteBackground } from '@/components/marketing/site-background';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';

// The marketing surface is dark-only by design; force `.dark` so design-system tokens resolve to dark regardless of the global theme.
const MarketingLayout = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <div className="dark text-foreground relative flex min-h-svh flex-col overflow-x-hidden">
    <SiteBackground />
    <SiteHeader />
    <main className="flex-1">{children}</main>
    <SiteFooter />
  </div>
);

export default MarketingLayout;
