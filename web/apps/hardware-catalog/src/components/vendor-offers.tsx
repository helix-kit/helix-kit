import { Badge } from '@helix/design-system/components/badge';
import { ExternalLink } from 'lucide-react';

import { formatMoney } from '@/lib/format';
import type { VendorOfferView } from '@/server/offers';

/**
 * Where to buy this board in India, from the vendors the catalog tracks.
 *
 * Out-of-stock listings stay on the table rather than being hidden: that a vendor carries the
 * board, and at what price, is worth knowing even when they cannot ship it today. They are
 * simply ranked below the ones you can buy, and labelled.
 */

const STOCK_LABEL: Record<string, string> = {
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
  backorder: 'Back order',
  preorder: 'Pre-order',
  discontinued: 'Discontinued',
  unknown: 'Unknown',
};

const STOCK_VARIANT: Record<string, 'default' | 'secondary'> = {
  in_stock: 'default',
  backorder: 'secondary',
};

const StockBadge = ({
  status,
  quantity,
}: {
  readonly status: string;
  readonly quantity: number | null;
}) => {
  const label = STOCK_LABEL[status] ?? status;
  const variant = STOCK_VARIANT[status] ?? 'outline';

  return (
    <Badge className="whitespace-nowrap" variant={variant}>
      {label}
      {/* Only Evelta publishes a real count; everyone else exposes a boolean. */}
      {quantity == null ? null : <span className="ml-1 opacity-80">· {quantity}</span>}
    </Badge>
  );
};

export const VendorOffers = ({ offers }: { readonly offers: readonly VendorOfferView[] }) => {
  if (offers.length === 0) {
    return (
      <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
        No tracked Indian vendor lists this board yet.
      </p>
    );
  }

  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Vendor</th>
            <th className="px-3 py-2 text-left font-medium">Price</th>
            <th className="px-3 py-2 text-left font-medium">Availability</th>
            <th className="px-3 py-2 text-right font-medium">Listing</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => (
            <tr key={offer.url} className="border-border border-t">
              <td className="px-3 py-2 align-top">
                <span className="font-medium">{offer.vendorName}</span>
                {offer.isStale ? (
                  <span
                    className="text-muted-foreground ml-2 text-xs"
                    title="Not confirmed recently — the vendor page may have changed or been removed."
                  >
                    stale
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 align-top whitespace-nowrap">
                {offer.amountMinor == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <>
                    <span className="font-medium">
                      {formatMoney(offer.amountMinor, offer.currencyCode)}
                    </span>
                    {offer.listAmountMinor != null && offer.listAmountMinor > offer.amountMinor ? (
                      <span className="text-muted-foreground ml-2 text-xs line-through">
                        {formatMoney(offer.listAmountMinor, offer.currencyCode)}
                      </span>
                    ) : null}
                  </>
                )}
              </td>
              <td className="px-3 py-2 align-top">
                <StockBadge quantity={offer.stockQuantity} status={offer.stockStatus} />
              </td>
              <td className="px-3 py-2 text-right align-top">
                <a
                  className="text-primary inline-flex items-center gap-1 hover:underline"
                  href={offer.url}
                  rel="noreferrer nofollow"
                  target="_blank"
                >
                  Open
                  <ExternalLink className="size-3" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
