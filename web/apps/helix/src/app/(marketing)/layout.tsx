import { SiteBackground } from '@/components/marketing/site-background';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { formatStars, getGitHubStars } from '@/lib/github';

const MarketingLayout = async ({ children }: Readonly<{ children: React.ReactNode }>) => {
  const stars = await getGitHubStars();

  return (
    <div className="text-foreground relative flex min-h-svh flex-col overflow-x-hidden">
      <SiteBackground />
      <SiteHeader stars={stars === null ? null : formatStars(stars)} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
};

export default MarketingLayout;
