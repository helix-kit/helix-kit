import { SiteBackground } from '@/components/marketing/site-background';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';

const MarketingLayout = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <div className="text-foreground relative flex min-h-svh flex-col overflow-x-hidden">
    <SiteBackground />
    <SiteHeader />
    <main className="flex-1">{children}</main>
    <SiteFooter />
  </div>
);

export default MarketingLayout;
