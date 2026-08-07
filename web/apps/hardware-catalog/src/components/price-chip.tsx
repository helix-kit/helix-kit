import type { CheapestPrice } from '@/lib/country';
import { formatMoney } from '@/lib/format';
import type { LivePrice } from '@/server/offers';

/**
 * The entry price for a listing card. Says "from" because it is the cheapest of several SKUs,
 * and names the SKU so the number is not mistaken for the price of the configuration on screen.
 */
/**
 * A live, in-stock vendor price. Preferred over the hand-entered estimate wherever one exists,
 * because it is a number the reader can actually pay today, from a named shop.
 */
export const LivePriceChip = ({ price }: { readonly price: LivePrice }) => (
  <span className="border-primary/30 bg-primary/10 inline-flex items-baseline gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap">
    <span className="font-medium">{formatMoney(price.amountMinor, price.currencyCode)}</span>
    <span className="text-muted-foreground">
      · {price.vendorName}
      {price.stockQuantity == null ? '' : ` · ${price.stockQuantity} in stock`}
    </span>
  </span>
);

export const PriceChip = ({
  price,
  suffix,
}: {
  readonly price: CheapestPrice | null | undefined;
  readonly suffix?: string;
}) => {
  if (price == null) {
    return <span className="text-muted-foreground text-xs whitespace-nowrap">no price</span>;
  }

  const detail = [price.variantName, suffix].filter((part) => part != null && part !== '');

  return (
    <span className="border-border bg-muted/50 inline-flex items-baseline gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap">
      <span className="text-muted-foreground">from</span>
      <span className="font-medium">{formatMoney(price.amountMinor, price.currencyCode)}</span>
      {detail.length === 0 ? null : (
        <span className="text-muted-foreground">· {detail.join(' · ')}</span>
      )}
    </span>
  );
};
