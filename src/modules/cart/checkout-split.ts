import { ListingMode } from '../listings/listings.constants.js';
import { PaymentMethod } from '../orders/orders.constants.js';

/** What the split needs to know about one line being bought. */
export interface SplitLine {
  listingId: string;
  sellerId: string;
  mode: ListingMode;
  /** The payment methods this listing accepts right now. */
  paymentMethods: PaymentMethod[];
}

/** One order a checkout will create. */
export interface PlannedOrder {
  /** Stable for the same selection: `seller:<id>` or `listing:<id>`. */
  key: string;
  sellerId: string;
  listingIds: string[];
  /** Methods every listing in the order accepts; never empty. */
  paymentMethods: PaymentMethod[];
}

const METHOD_ORDER = [PaymentMethod.PrepaidQr, PaymentMethod.PayOnDelivery];

function common(sets: PaymentMethod[][]): PaymentMethod[] {
  return METHOD_ORDER.filter((method) =>
    sets.every((set) => set.includes(method)),
  );
}

/**
 * Splits a selection into orders, in the order lines were given:
 *
 * - each pre-order listing is its own order (its own round, deadline,
 *   delivery date and summary);
 * - a seller's in-stock lines share one order, when their listings accept a
 *   common payment method; otherwise each listing is its own order.
 */
export function splitIntoOrders(
  lines: ReadonlyArray<SplitLine>,
): PlannedOrder[] {
  const groups = new Map<string, SplitLine[]>();
  for (const line of lines) {
    const key =
      line.mode === ListingMode.Preorder
        ? `listing:${line.listingId}`
        : `seller:${line.sellerId}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  const orders: PlannedOrder[] = [];
  for (const [key, grouped] of groups) {
    const byListing = new Map<string, SplitLine[]>();
    for (const line of grouped) {
      byListing.set(line.listingId, [
        ...(byListing.get(line.listingId) ?? []),
        line,
      ]);
    }
    const shared = common(
      [...byListing.values()].map(
        (listingLines) => listingLines[0].paymentMethods,
      ),
    );
    if (shared.length > 0) {
      orders.push({
        key,
        sellerId: grouped[0].sellerId,
        listingIds: grouped.map((line) => line.listingId),
        paymentMethods: shared,
      });
      continue;
    }
    for (const [listingId, listingLines] of byListing) {
      orders.push({
        key: `listing:${listingId}`,
        sellerId: listingLines[0].sellerId,
        listingIds: listingLines.map((line) => line.listingId),
        paymentMethods: common([listingLines[0].paymentMethods]),
      });
    }
  }
  return orders;
}
