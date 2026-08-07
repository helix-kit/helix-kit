import 'server-only';

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { db } from './db';
import { vendor, vendorOffer } from './schema';

/**
 * Live vendor offers: what a board actually costs from a real shop today, as opposed to
 * `priceEstimate`, which is the hand-entered fallback for products no tracked vendor stocks.
 *
 * Two rules shape everything here:
 *
 * - **Only in-stock offers set a headline price.** An out-of-stock listing is kept, because
 *   knowing a vendor carries the board and at what price is useful, but quoting it as "the
 *   price" would send a reader to a shop that cannot sell it.
 * - **An offer that has not been re-read recently is marked stale rather than shown as
 *   current.** If a vendor delists a product its URL starts failing, and the row keeps its
 *   last known price; without this that dead price would look live.
 */

/** Beyond this, a price is old enough that it should be presented with a caveat. */
const STALE_AFTER_HOURS = 48;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;
const MS_PER_HOUR = MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

export type VendorOfferView = {
  vendorName: string;
  vendorSlug: string;
  url: string;
  title: string;
  amountMinor: number | null;
  listAmountMinor: number | null;
  currencyCode: string;
  stockStatus: string;
  stockQuantity: number | null;
  lastSeenAt: Date;
  isStale: boolean;
};

const isStale = (lastSeenAt: Date, failures: number): boolean =>
  failures > 0 || Date.now() - lastSeenAt.getTime() > STALE_AFTER_HOURS * MS_PER_HOUR;

/** Every tracked vendor's terms for one product, cheapest in-stock first. */
export const offersForProduct = async (productId: string): Promise<VendorOfferView[]> => {
  const rows = await db
    .select({
      vendorName: vendor.name,
      vendorSlug: vendor.slug,
      url: vendorOffer.url,
      title: vendorOffer.title,
      amountMinor: vendorOffer.amountMinor,
      listAmountMinor: vendorOffer.listAmountMinor,
      currencyCode: vendorOffer.currencyCode,
      stockStatus: vendorOffer.stockStatus,
      stockQuantity: vendorOffer.stockQuantity,
      lastSeenAt: vendorOffer.lastSeenAt,
      failures: vendorOffer.consecutiveFailures,
    })
    .from(vendorOffer)
    .innerJoin(vendor, eq(vendor.id, vendorOffer.vendorId))
    .where(eq(vendorOffer.productId, productId));

  // Buyable first, then back-order, then everything else.
  const STOCK_RANK: Record<string, number> = { in_stock: 0, backorder: 1 };
  const rank = (status: string): number => STOCK_RANK[status] ?? 2;

  return rows
    .map((row) => ({
      ...row,
      isStale: isStale(row.lastSeenAt, row.failures),
    }))
    .sort((left, right) => {
      const byStock = rank(left.stockStatus) - rank(right.stockStatus);
      if (byStock !== 0) {
        return byStock;
      }
      return (left.amountMinor ?? Infinity) - (right.amountMinor ?? Infinity);
    });
};

export type LivePrice = {
  amountMinor: number;
  currencyCode: string;
  vendorName: string;
  url: string;
  stockQuantity: number | null;
};

/**
 * productId → cheapest currently-buyable offer. Out-of-stock rows are excluded on purpose:
 * a chip that says "from ₹5,044" has to be a price the reader can actually pay.
 */
export const cheapestLiveByProduct = async (
  productIds: readonly string[],
): Promise<Map<string, LivePrice>> => {
  if (productIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      productId: vendorOffer.productId,
      amountMinor: vendorOffer.amountMinor,
      currencyCode: vendorOffer.currencyCode,
      vendorName: vendor.name,
      url: vendorOffer.url,
      stockQuantity: vendorOffer.stockQuantity,
    })
    .from(vendorOffer)
    .innerJoin(vendor, eq(vendor.id, vendorOffer.vendorId))
    .where(
      and(
        inArray(vendorOffer.productId, productIds),
        eq(vendorOffer.stockStatus, 'in_stock'),
        isNotNull(vendorOffer.amountMinor),
        eq(vendorOffer.consecutiveFailures, 0),
        sql`${vendorOffer.lastSeenAt} > now() - make_interval(hours => ${STALE_AFTER_HOURS})`,
      ),
    )
    .orderBy(vendorOffer.amountMinor);

  const cheapest = new Map<string, LivePrice>();
  for (const row of rows) {
    if (row.amountMinor == null || cheapest.has(row.productId)) {
      continue; // rows arrive cheapest-first, so the first per product wins
    }
    cheapest.set(row.productId, {
      amountMinor: row.amountMinor,
      currencyCode: row.currencyCode,
      vendorName: row.vendorName,
      url: row.url,
      stockQuantity: row.stockQuantity,
    });
  }
  return cheapest;
};

/** How many vendors are tracked and how many offers exist, for the empty-state copy. */
export const offerCoverage = async (): Promise<{ vendors: number; offers: number }> => {
  const [vendors] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(vendor)
    .where(eq(vendor.isActive, true));
  const [offers] = await db.select({ value: sql<number>`count(*)::int` }).from(vendorOffer);
  return { vendors: vendors?.value ?? 0, offers: offers?.value ?? 0 };
};
