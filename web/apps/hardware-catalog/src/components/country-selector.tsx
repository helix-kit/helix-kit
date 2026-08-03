'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { COUNTRY_COOKIE } from '@/lib/country';

const ONE_YEAR_SECONDS = 31_536_000;

/**
 * Switches the country every price on the site is shown for. Writes a cookie and refreshes, so
 * the server components re-render with the new country — no client-side price state to drift.
 */
export const CountrySelector = ({
  countries,
  selected,
}: {
  readonly countries: readonly { code: string; label: string }[];
  readonly selected: string;
}) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (countries.length === 0) {
    return null;
  }

  return (
    <label className="text-muted-foreground flex items-center gap-1.5 text-sm">
      <span className="sr-only">Prices for</span>
      <select
        className="border-border bg-background hover:border-primary/60 rounded border px-2 py-1 text-sm transition-colors"
        disabled={isPending}
        value={selected}
        onChange={(event) => {
          const country = event.target.value;
          document.cookie = `${COUNTRY_COOKIE}=${country}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
          startTransition(() => {
            router.refresh();
          });
        }}
      >
        {countries.map((country) => (
          <option key={country.code} value={country.code}>
            {country.label}
          </option>
        ))}
      </select>
    </label>
  );
};
