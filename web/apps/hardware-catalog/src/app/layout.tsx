import './globals.css';

import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';

import { NuqsAdapter } from 'nuqs/adapters/next/app';

import { CountrySelector } from '@/components/country-selector';
import { availableCountries, selectedCountry } from '@/server/pricing';
import { TRPCReactProvider } from '@/server/react';

import type { Metadata } from 'next';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Hardware Catalog',
    template: '%s — Hardware Catalog',
  },
  description:
    'Embedded silicon and board intelligence: SoCs, MCUs, modules and boards modelled as a graph — cores, peripherals, accelerators, radios, and what each board actually exposes.',
};

const RootLayout = async ({ children }: Readonly<{ children: React.ReactNode }>) => {
  const [countries, country] = await Promise.all([availableCountries(), selectedCountry()]);

  return (
    <html className={`${geistSans.variable} ${geistMono.variable}`} lang="en">
      <body className="bg-background text-foreground min-h-svh font-sans antialiased">
        <TRPCReactProvider>
          <NuqsAdapter>
            <div className="flex min-h-svh flex-col">
              <header className="border-border bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
                <nav className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
                  <Link className="font-semibold tracking-tight" href="/">
                    Hardware Catalog
                  </Link>
                  <div className="text-muted-foreground flex items-center gap-4 text-sm">
                    <Link className="hover:text-foreground transition-colors" href="/silicon">
                      Silicon
                    </Link>
                    <Link className="hover:text-foreground transition-colors" href="/products">
                      Products
                    </Link>
                    <Link className="hover:text-foreground transition-colors" href="/compare">
                      Compare
                    </Link>
                    <Link className="hover:text-foreground transition-colors" href="/admin">
                      Admin
                    </Link>
                  </div>
                  <div className="ml-auto">
                    <CountrySelector countries={countries} selected={country} />
                  </div>
                </nav>
              </header>
              <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>
            </div>
          </NuqsAdapter>
        </TRPCReactProvider>
      </body>
    </html>
  );
};

export default RootLayout;
