import { boolean, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

import {
  stockStatusEnum,
  timestamps,
  vendorFetchStrategyEnum,
  vendorPlatformEnum,
} from './_shared';
import { product, productVariant } from './product';
import { provenance } from './provenance';

/**
 * Retailers whose listings are trusted enough to write into the catalog, and how to read each
 * one. Membership is deliberately a closed list: an arbitrary marketplace seller is not
 * evidence of anything, whereas an established distributor's own product page is.
 *
 * `platform` and `fetchStrategy` are operational, not descriptive — they select the adapter.
 * Both were established by probing the live sites rather than assumed, because the difference
 * between a JSON feed and scraped HTML decides whether a price is exact or a guess.
 */
export const vendor = pgTable(
  'vendor',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** Origin only, no trailing slash: `https://robu.in`. */
    baseUrl: text('base_url').notNull(),
    countryCode: text('country_code').notNull().default('IN'),
    currencyCode: text('currency_code').notNull().default('INR'),
    platform: vendorPlatformEnum('platform').notNull(),
    fetchStrategy: vendorFetchStrategyEnum('fetch_strategy').notNull(),
    /**
     * CSS selector for the element the product page designates as *the* price. Needed because a
     * generic `.price` also matches related-product rails and discount badges — which is exactly
     * how an early version of the price checker mistook a "-25%" badge for a ₹25 price.
     */
    priceSelector: text('price_selector').notNull().default(''),
    /** Selector carrying availability, and a count where the vendor publishes one. */
    stockSelector: text('stock_selector').notNull().default(''),
    /** True when this vendor exposes a real number rather than only in/out of stock. */
    publishesStockCount: boolean('publishes_stock_count').notNull().default(false),
    /** Product URL listing, used to enumerate the catalogue. */
    sitemapUrl: text('sitemap_url').notNull().default(''),
    /** Rejects scripted requests, so its adapter must drive a real browser. */
    requiresBrowser: boolean('requires_browser').notNull().default(false),
    /** Politeness budget; the refresher sleeps to stay under it. */
    requestsPerSecond: integer('requests_per_second').notNull().default(1),
    /** Listed prices normally include GST in India — recorded so totals stay comparable. */
    pricesIncludeTax: boolean('prices_include_tax').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes').notNull().default(''),
    ...timestamps,
  },
  (table) => [
    unique('vendor_slug_unique').on(table.slug),
    index('vendor_country_idx').on(table.countryCode),
  ],
);

/**
 * What one vendor sells one product for, right now. Exactly one row per
 * (vendor, product, variant) — the current state — with movement kept in `vendorOfferSnapshot`.
 *
 * This is the live counterpart to `priceEstimate`, which stays as the hand-entered fallback for
 * products no vendor here stocks. Amounts are integer minor units; Shopify's product JSON
 * conveniently reports paise directly, so no float ever touches a price.
 */
export const vendorOffer = pgTable(
  'vendor_offer',
  {
    id: text('id').primaryKey(),
    vendorId: text('vendor_id')
      .notNull()
      .references(() => vendor.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    /** Set when the listing is for a specific SKU rather than the design generally. */
    variantId: text('variant_id').references(() => productVariant.id, { onDelete: 'cascade' }),
    /** The vendor's own product page — also the natural dedupe key within a vendor. */
    url: text('url').notNull(),
    vendorSku: text('vendor_sku').notNull().default(''),
    title: text('title').notNull().default(''),
    currencyCode: text('currency_code').notNull().default('INR'),
    /** Minor units: 1074999 = ₹10,749.99. */
    amountMinor: integer('amount_minor'),
    /** Pre-discount price where the vendor shows one, so a real discount is distinguishable. */
    listAmountMinor: integer('list_amount_minor'),
    stockStatus: stockStatusEnum('stock_status').notNull().default('unknown'),
    /** Null unless the vendor publishes an actual number (Evelta does; Shopify does not). */
    stockQuantity: integer('stock_quantity'),
    inStock: boolean('in_stock'),
    /** Last time the adapter successfully read this listing. */
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
    /** Set when a fetch fails, so a dead listing is visible instead of silently frozen. */
    lastErrorAt: timestamp('last_error_at'),
    lastError: text('last_error').notNull().default(''),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    notes: text('notes').notNull().default(''),
    ...provenance,
    ...timestamps,
  },
  (table) => [
    unique('vendor_offer_scope_unique').on(table.vendorId, table.productId, table.variantId),
    unique('vendor_offer_url_unique').on(table.vendorId, table.url),
    index('vendor_offer_product_idx').on(table.productId),
    index('vendor_offer_vendor_idx').on(table.vendorId),
    index('vendor_offer_stock_idx').on(table.stockStatus),
  ],
);

/**
 * Append-only history behind `vendorOffer`. A row is written only when the price or stock
 * actually changes, so the table records movement rather than the polling interval — which is
 * what makes "has this dropped?" and "how often is it out of stock?" answerable.
 */
export const vendorOfferSnapshot = pgTable(
  'vendor_offer_snapshot',
  {
    id: text('id').primaryKey(),
    offerId: text('offer_id')
      .notNull()
      .references(() => vendorOffer.id, { onDelete: 'cascade' }),
    amountMinor: integer('amount_minor'),
    listAmountMinor: integer('list_amount_minor'),
    stockStatus: stockStatusEnum('stock_status').notNull().default('unknown'),
    stockQuantity: integer('stock_quantity'),
    observedAt: timestamp('observed_at').defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    index('vendor_offer_snapshot_offer_idx').on(table.offerId, table.observedAt),
  ],
);

export type Vendor = typeof vendor.$inferSelect;
export type NewVendor = typeof vendor.$inferInsert;
export type VendorOffer = typeof vendorOffer.$inferSelect;
export type NewVendorOffer = typeof vendorOffer.$inferInsert;
export type VendorOfferSnapshot = typeof vendorOfferSnapshot.$inferSelect;
export type NewVendorOfferSnapshot = typeof vendorOfferSnapshot.$inferInsert;
