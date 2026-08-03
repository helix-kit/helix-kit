import 'server-only';

import { cookies } from 'next/headers';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { COUNTRY_COOKIE, DEFAULT_COUNTRY, type CheapestPrice } from '@/lib/country';
import { countryName } from '@/lib/format';

import { db } from './db';
import { priceEstimate, productSilicon, productVariant } from './schema';

/**
 * "What does this cost here?" — resolved for whatever country the reader has selected.
 *
 * The cheapest row wins, because the question a listing chip answers is the entry price, not
 * the price of some particular SKU. Which SKU it was comes back with it so the chip can say so.
 */

/** Countries the catalog actually has prices for; there is no point offering the rest. */
export const availableCountries = async (): Promise<{ code: string; label: string }[]> => {
  const rows = await db
    .selectDistinct({ code: priceEstimate.countryCode })
    .from(priceEstimate)
    .orderBy(priceEstimate.countryCode);
  return rows.map((row) => ({ code: row.code, label: countryName(row.code) }));
};

export const selectedCountry = async (): Promise<string> => {
  const store = await cookies();
  return store.get(COUNTRY_COOKIE)?.value ?? DEFAULT_COUNTRY;
};

const cheapestOf = (
  rows: readonly { amountMinor: number; currencyCode: string; variantName: string | null }[],
): CheapestPrice | null => {
  let best: CheapestPrice | null = null;
  for (const row of rows) {
    if (best == null || row.amountMinor < best.amountMinor) {
      best = row;
    }
  }
  return best;
};

/** productId → its cheapest price in `country`. */
export const cheapestByProduct = async (
  productIds: readonly string[],
  country: string,
): Promise<Map<string, CheapestPrice>> => {
  if (productIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      productId: priceEstimate.productId,
      amountMinor: priceEstimate.amountMinor,
      currencyCode: priceEstimate.currencyCode,
      variantName: productVariant.name,
    })
    .from(priceEstimate)
    .leftJoin(productVariant, eq(priceEstimate.variantId, productVariant.id))
    .where(
      and(
        inArray(priceEstimate.productId, [...productIds]),
        eq(priceEstimate.countryCode, country),
      ),
    );

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = grouped.get(row.productId);
    if (bucket == null) {
      grouped.set(row.productId, [row]);
    } else {
      bucket.push(row);
    }
  }

  const cheapest = new Map<string, CheapestPrice>();
  for (const [productId, bucket] of grouped) {
    const best = cheapestOf(bucket);
    if (best != null) {
      cheapest.set(productId, best);
    }
  }
  return cheapest;
};

export type CheapestForSilicon = CheapestPrice & { productName: string; productSlug: string };

/**
 * siliconId → the cheapest way to actually buy that chip in `country`: the least expensive
 * variant of any product carrying it. A chip has no price of its own, so this is the closest
 * honest answer to "what does it cost to get one".
 */
export const cheapestBySilicon = async (
  siliconIds: readonly string[],
  country: string,
): Promise<Map<string, CheapestForSilicon>> => {
  if (siliconIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      siliconId: productSilicon.siliconId,
      amountMinor: priceEstimate.amountMinor,
      currencyCode: priceEstimate.currencyCode,
      variantName: productVariant.name,
      productName: sql<string>`product.name`,
      productSlug: sql<string>`product.slug`,
    })
    .from(productSilicon)
    .innerJoin(priceEstimate, eq(priceEstimate.productId, productSilicon.productId))
    .innerJoin(sql`product`, sql`product.id = ${productSilicon.productId}`)
    .leftJoin(productVariant, eq(priceEstimate.variantId, productVariant.id))
    .where(
      and(
        inArray(productSilicon.siliconId, [...siliconIds]),
        eq(priceEstimate.countryCode, country),
      ),
    );

  const cheapest = new Map<string, CheapestForSilicon>();
  for (const row of rows) {
    const current = cheapest.get(row.siliconId);
    if (current == null || row.amountMinor < current.amountMinor) {
      cheapest.set(row.siliconId, {
        amountMinor: row.amountMinor,
        currencyCode: row.currencyCode,
        variantName: row.variantName,
        productName: row.productName,
        productSlug: row.productSlug,
      });
    }
  }
  return cheapest;
};
