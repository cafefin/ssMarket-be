import { randomUUID } from 'node:crypto';
import type { TestAgent } from './auth.js';

/** The fields of a listing that the integration tests read. */
export type TestListing = {
  id: string;
  title: string;
  mode: 'in_stock' | 'preorder';
  unit: string;
  unitPrice: number;
  stockQuantity: number | null;
  combos: Array<{ quantity: string; price: number }>;
  seller: { id: string; handle: string };
  orderCount: number;
};

/** A valid in-stock product body; categories 1-6 are seeded. */
export const inStockBody = (overrides: object = {}) => ({
  mode: 'in_stock',
  condition: 'good',
  title: 'Loa JBL Go 3',
  categoryId: 4,
  acceptsPrepaidQr: true,
  acceptsPayOnDelivery: true,
  unit: 'cái',
  unitPrice: 500000,
  stockQuantity: '3',
  ...overrides,
});

/** A valid pre-order body: the deadline is in three days. */
export const preorderBody = (overrides: object = {}) => ({
  mode: 'preorder',
  title: 'Cam sành tuần này',
  categoryId: 2,
  acceptsPrepaidQr: true,
  acceptsPayOnDelivery: true,
  unit: 'kg',
  unitPrice: 35000,
  orderDeadline: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  deliveryDate: new Date(Date.now() + 5 * 86_400_000)
    .toISOString()
    .slice(0, 10),
  ...overrides,
});

/** Creates and publishes a listing as `seller`. */
export async function publish(
  seller: TestAgent,
  body: object,
): Promise<TestListing> {
  const created = await seller.post('/listings').send(body).expect(201);
  const id = (created.body as TestListing).id;
  const published = await seller.post(`/listings/${id}/publish`).expect(200);
  return published.body as TestListing;
}

/** The checkout key of the single order that buying `listing` alone creates. */
export function orderKey(listing: TestListing): string {
  return listing.mode === 'preorder'
    ? `listing:${listing.id}`
    : `seller:${listing.seller.id}`;
}

export interface Purchase {
  listing: TestListing;
  quantity: string;
}

/** How the single order is paid and delivered; other keys go into the body as-is. */
export interface Choice {
  paymentMethod?: string;
  deliveryLocation?: string;
  note?: string | null;
  [extra: string]: unknown;
}

/**
 * Buys products of one order through POST /checkout (not from the cart).
 * Returns the request so a test can check the status; the body holds
 * `orders`.
 */
export function checkout(
  agent: TestAgent,
  purchases: Purchase[],
  choice: Choice = {},
  key: string = randomUUID(),
) {
  const { paymentMethod, deliveryLocation, note, ...extra } = choice;
  return agent
    .post('/checkout')
    .set('Idempotency-Key', key)
    .send({
      lines: purchases.map(({ listing, quantity }) => ({
        listingId: listing.id,
        quantity,
      })),
      orders: [
        {
          key: orderKey(purchases[0].listing),
          paymentMethod: paymentMethod ?? 'pay_on_delivery',
          deliveryLocation: deliveryLocation ?? 'Tầng 7',
          ...(note === undefined ? {} : { note }),
        },
      ],
      fromCart: false,
      ...extra,
    });
}
