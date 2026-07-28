import './globals.css';

import { Geist, Geist_Mono, Space_Grotesk } from 'next/font/google';

import { CookiesProvider } from 'next-client-cookies/server';

import { publicOrigin } from '@/lib/site';

import AppProviders from './providers';

import type { Metadata } from 'next';

// One app, one <html>. This root serves BOTH the public site (marketing, docs,
// blog) and the product (admin, device apps), so it carries the fonts the
// marketing/docs CSS depends on: globals.css maps --font-sans onto
// --font-geist-sans, and everything falls back to Arial without these loaders.
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Display face for the marketing hero + section headings (the "Helix Spine").
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
  },
  twitter: {
    card: 'summary_large_image',
  },
};

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  // suppressHydrationWarning: the theme bootstrap (see providers.tsx) sets the
  // theme class on <html> before hydration, which would otherwise trip a
  // mismatch warning.
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
