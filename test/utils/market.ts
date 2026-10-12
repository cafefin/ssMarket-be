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
  campaign: { id: string } | null;
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

/** The fields of a pre-order round that the integration tests read. */
export type TestCampaign = {
  id: string;
  title: string;
  status: string;
  isOpen: boolean;
  orderDeadline: string;
  deliveryDate: string;
  seller: { id: string; handle: string };
  items: Array<{
    id: string;
    title: string;
    unit: string;
    unitPrice: number;
    selling: boolean;
    orderCount: number;
    removable: boolean;
  }>;
};

/** A valid product of a round. */
export const itemBody = (overrides: object = {}) => ({
  title: 'Bánh bao chay',
  unit: 'cái',
  unitPrice: 15000,
  ...overrides,
});

/** A valid round: deadline in three days, delivery in five, two products. */
export const campaignBody = (overrides: object = {}) => ({
  title: 'Bánh bao tuần này',
  categoryId: 2,
  acceptsPrepaidQr: false,
  acceptsPayOnDelivery: true,
  orderDeadline: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  deliveryDate: new Date(Date.now() + 5 * 86_400_000)
    .toISOString()
    .slice(0, 10),
  items: [
    itemBody(),
    itemBody({ title: 'Bánh bao nhân thịt', unitPrice: 18000 }),
  ],
  ...overrides,
});

/** Creates and publishes a round as `seller`. */
export async function publishCampaign(
  seller: TestAgent,
  body: object = campaignBody(),
): Promise<TestCampaign> {
  const created = await seller.post('/campaigns').send(body).expect(201);
  const published = await seller
    .post(`/campaigns/${(created.body as TestCampaign).id}/publish`)
    .expect(200);
  return published.body as TestCampaign;
}

/** A campaign item in the shape `checkout` takes. */
export function itemOf(campaign: TestCampaign, index = 0): TestListing {
  const item = campaign.items[index];
  return {
    id: item.id,
    title: item.title,
    mode: 'preorder',
    unit: item.unit,
    unitPrice: item.unitPrice,
    stockQuantity: null,
    combos: [],
    seller: campaign.seller,
    orderCount: item.orderCount,
    campaign: { id: campaign.id },
  };
}

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
  return listing.campaign
    ? `campaign:${listing.campaign.id}`
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
