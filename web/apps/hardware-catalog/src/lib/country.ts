/**
 * The reader's country, which decides which price they are shown. Held in a cookie rather than
 * a query parameter because it is a preference that should survive navigation across every
 * page, not part of any one page's state.
 */
export const COUNTRY_COOKIE = 'catalog-country';

export const DEFAULT_COUNTRY = 'IN';

/** A price row reduced to what a chip needs. */
export type CheapestPrice = {
  amountMinor: number;
  currencyCode: string;
  /** Which SKU the figure is for, when it is not the product as a whole. */
  variantName: string | null;
};
