import './globals.css';

import { Geist, Geist_Mono, Space_Grotesk } from 'next/font/google';

import { CookiesProvider } from 'next-client-cookies/server';

import { publicOrigin, site } from '@/lib/site';

import AppProviders from './providers';

import type { Metadata, Viewport } from 'next';

// globals.css maps --font-sans onto --font-geist-sans; without these loaders everything falls back to Arial.
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const spaceGrotesk = Space_Grotesk({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin),
  title: {
    default: 'Helix — the open IoT platform you compose yourself',
    template: '%s — Helix',
  },
  description:
    'Helix is an open-source IoT platform assembled from reusable, independently adoptable components — embedded firmware, a minimal edge Linux OS, a cloud control plane, and clients, all speaking one transport-neutral protocol.',
  openGraph: {
    type: 'website',
    siteName: 'Helix',
    url: publicOrigin,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    site: site.twitter,
    creator: site.twitter,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  // suppressHydrationWarning: the theme bootstrap (providers.tsx) sets the theme class before hydration.
  <html
    className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable}`}
    lang="en"
    suppressHydrationWarning
  >
    <body className="bg-background text-foreground min-h-svh font-sans antialiased">
      <CookiesProvider>
        <AppProviders>{children}</AppProviders>
      </CookiesProvider>
    </body>
  </html>
);

export default RootLayout;
