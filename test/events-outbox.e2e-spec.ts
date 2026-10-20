import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';
import {
  campaignBody,
  checkout,
  inStockBody,
  itemBody,
  itemOf,
  publish,
  publishCampaign,
  type TestListing,
} from './utils/market.js';

type Placed = { id: string; code: string; totalAmount: number };
type EventRow = { type: string; payload: Record<string, unknown> };

const bank = {
  bankBin: '970436',
  bankAccountNumber: '0123456789',
  bankAccountName: 'Nguyen Van An',
};

describe('Order events in the outbox', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let seller: TestAgent;
  let buyer: TestAgent;

  const events = (): Promise<EventRow[]> =>
    dataSource.query(
      'SELECT type, payload FROM outbox_events ORDER BY occurred_at, id',
    );
  const buy = async (listing: TestListing, quantity: string, agent = buyer) =>
    (
      (
        await checkout(agent, [{ listing, quantity }], {
          paymentMethod: 'prepaid_qr',
          deliveryLocation: 'Tầng 7',
        }).expect(201)
      ).body as { orders: Placed[] }
    ).orders[0];
  const act = (agent: TestAgent, id: string, action: string, body = {}) =>
    agent.post(`/orders/${id}/${action}`).send(body);
  const clear = () => dataSource.query('DELETE FROM outbox_events');

  beforeAll(async () => {
    app = await createTestApp(identity);
    dataSource = app.get(DataSource);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('DELETE FROM outbox_events');
    await redis.flushdb();
    seller = await signIn(app, identity, 'seller');
    buyer = await signIn(app, identity, 'buyer');
    await seller.patch('/users/me').send(bank).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('writes order.placed with the order details at checkout', async () => {
    const listing = await publish(seller, inStockBody({ title: 'Loa JBL' }));
    await clear();

    const placed = await buy(listing, '2');

    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('order.placed');
    expect(rows[0].payload).toMatchObject({
      orderId: placed.id,
      orderCode: placed.code,
      buyerName: 'buyer',
      sellerName: 'seller',
      title: 'Loa JBL',
      total: placed.totalAmount,
      actor: 'buyer',
      reason: null,
    });
  });

  it('writes nothing when the checkout rolls back', async () => {
    const listing = await publish(seller, inStockBody({ stockQuantity: '1' }));
    await clear();

    const response = await checkout(buyer, [{ listing, quantity: '5' }], {
      paymentMethod: 'prepaid_qr',
      deliveryLocation: 'Tầng 7',
    }).expect(409);

    expect((response.body as { code: string }).code).toBe('OUT_OF_STOCK');
    expect(await events()).toEqual([]);
  });

  it('writes one event for each payment and delivery step', async () => {
    const listing = await publish(seller, inStockBody());
    const placed = await buy(listing, '1');
    await clear();

    await act(buyer, placed.id, 'report-payment').expect(200);
    await act(seller, placed.id, 'confirm-payment').expect(200);
    await act(seller, placed.id, 'deliver').expect(200);

    expect((await events()).map((row) => row.type)).toEqual([
      'order.payment_reported',
      'order.payment_confirmed',
      'order.delivered',
    ]);
  });

  it('writes order.payment_rejected', async () => {
    const listing = await publish(seller, inStockBody());
    const placed = await buy(listing, '1');
    await act(buyer, placed.id, 'report-payment').expect(200);
    await clear();

    await act(seller, placed.id, 'reject-payment').expect(200);

    expect((await events()).map((row) => row.type)).toEqual([
      'order.payment_rejected',
    ]);
  });

  it('writes order.cancelled with the seller reason', async () => {
    const listing = await publish(seller, inStockBody());
    const placed = await buy(listing, '1');
    await clear();

    await act(seller, placed.id, 'cancel', { reason: 'Hết hàng' }).expect(200);

    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'order.cancelled',
      payload: { actor: 'seller', reason: 'Hết hàng' },
    });
  });

  it('writes order.edited when a buyer edits a pre-order', async () => {
    const round = await publishCampaign(
      seller,
      campaignBody({
        acceptsPrepaidQr: true,
        items: [itemBody({ title: 'Cam sành', unit: 'kg', unitPrice: 35000 })],
      }),
    );
    const item = itemOf(round);
    const placed = await buy(item, '1');
    await clear();

    await buyer
      .patch(`/orders/${placed.id}`)
      .send({
        lines: [{ listingId: item.id, quantity: '3' }],
        paymentMethod: 'pay_on_delivery',
        deliveryLocation: 'Tầng 7',
      })
      .expect(200);

    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'order.edited',
      payload: { orderId: placed.id, total: 105000, title: round.title },
    });
  });
  it('writes campaign.opened with the number of products when a round is published', async () => {
    const created = await seller
      .post('/campaigns')
      .send(campaignBody({ title: 'Bánh bao tuần này' }))
      .expect(201);
    expect(await events()).toEqual([]);

    const id = (created.body as { id: string }).id;
    await seller.post(`/campaigns/${id}/publish`).expect(200);

    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'campaign.opened',
      payload: {
        campaignId: id,
        sellerName: 'seller',
        campaignTitle: 'Bánh bao tuần này',
        categoryName: 'Thực phẩm tươi',
        itemCount: 2,
      },
    });
  });

  it('writes campaign.reopened when the copy of a closed round is published', async () => {
    const round = await publishCampaign(seller);
    await seller.post(`/campaigns/${round.id}/close`).expect(200);
    const copy = await seller.post(`/campaigns/${round.id}/reopen`).expect(201);
    await clear();

    await seller
      .post(`/campaigns/${(copy.body as { id: string }).id}/publish`)
      .expect(200);

    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'campaign.reopened',
      payload: { campaignId: (copy.body as { id: string }).id, itemCount: 2 },
    });
  });

  it('writes listing.published when an in-stock product is published', async () => {
    const created = await seller
      .post('/listings')
      .send(inStockBody({ title: 'Loa JBL', unitPrice: 450000 }))
      .expect(201);
    expect(await events()).toEqual([]);

    const id = (created.body as { id: string }).id;
    await seller.post(`/listings/${id}/publish`).expect(200);

    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'listing.published',
      payload: {
        listingId: id,
        sellerName: 'seller',
        listingTitle: 'Loa JBL',
        unitPrice: 450000,
      },
    });
  });

  it('writes nothing when a publish is refused for a hidden category', async () => {
    const listing = await seller
      .post('/listings')
      .send(inStockBody())
      .expect(201);
    const round = await seller
      .post('/campaigns')
      .send(campaignBody())
      .expect(201);
    await dataSource.query(
      'UPDATE categories SET is_active = false WHERE id IN (2, 4)',
    );
    try {
      await seller
        .post(`/listings/${(listing.body as { id: string }).id}/publish`)
        .expect(400);
      await seller
        .post(`/campaigns/${(round.body as { id: string }).id}/publish`)
        .expect(400);
    } finally {
      await dataSource.query(
        'UPDATE categories SET is_active = true WHERE id IN (2, 4)',
      );
    }

    expect(await events()).toEqual([]);
  });
});
