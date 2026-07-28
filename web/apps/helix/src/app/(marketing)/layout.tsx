import { SiteBackground } from '@/components/marketing/site-background';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';

/* The marketing surface is dark-only by design (the diagrams and glow are tuned
 * for a near-black canvas). We force `.dark` on the shell so the design-system
 * tokens resolve to their dark values regardless of the global theme, and keep the
 * wrapper transparent so the fixed SiteBackground shows through. */
const MarketingLayout = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <div className="dark text-foreground relative flex min-h-svh flex-col overflow-x-hidden">
    <SiteBackground />
    <SiteHeader />
    <main className="flex-1">{children}</main>
    <SiteFooter />
  </div>
);

export default MarketingLayout;
