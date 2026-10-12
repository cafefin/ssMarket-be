import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';
import {
  campaignBody,
  type Choice,
  checkout,
  inStockBody,
  itemBody,
  itemOf,
  publish as publishAs,
  publishCampaign,
  type TestCampaign,
  type TestListing,
} from './utils/market.js';

type Listing = TestListing;
type Order = {
  id: string;
  code: string;
  totalAmount: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  qr: { amount: number } | null;
  lines: Array<{ title: string; unitPrice: number; quantity: number }>;
};
type Summary = {
  listing: { unit: string };
  rows: Array<{
    orderId: string;
    code: string;
    buyer: { name: string; email: string };
    deliveryLocation: string;
    quantity: number;
    totalAmount: number;
    paymentStatus: string;
    fulfillmentStatus: string;
  }>;
  totals: {
    orderCount: number;
    quantity: number;
    totalAmount: number;
    paidAmount: number;
    outstandingAmount: number;
  };
};

const bank = {
  bankBin: '970436',
  bankAccountNumber: '0123456789',
  bankAccountName: 'Nguyen Van An',
};

describe('Seller tools: summary and order editing', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let seller: TestAgent;
  let minh: TestAgent;
  let lan: TestAgent;
  /** In-stock oranges by the kg: the listing whose summary is read. */
  let stall: Listing;

  const stallBody = (overrides: object = {}) =>
    inStockBody({
      title: 'Cam sành tuần 41',
      description: 'Giao tận tầng',
      categoryId: 2,
      condition: undefined,
      unit: 'kg',
      unitPrice: 35000,
      stockQuantity: '100',
      ...overrides,
    });
  const publish = async (body: object): Promise<Listing> =>
    (await publishAs(seller, body)) as Listing;
  /** A pre-order round of one product, 35,000 đ per kg, QR or pay on delivery. */
  const openRound = (title = 'Cam sành tuần 41'): Promise<TestCampaign> =>
    publishCampaign(
      seller,
      campaignBody({
        title: `Đợt ${title}`,
        acceptsPrepaidQr: true,
        items: [itemBody({ title, unit: 'kg', unitPrice: 35000 })],
      }),
    );
  const order = async (
    agent: TestAgent,
    quantity: string,
    choice: Choice = {},
    listing: Listing = stall,
  ): Promise<Order> =>
    (
      (await checkout(agent, [{ listing, quantity }], choice).expect(201))
        .body as { orders: Order[] }
    ).orders[0];
  const summary = async (query = ''): Promise<Summary> =>
    (await seller.get(`/listings/${stall.id}/summary${query}`).expect(200))
      .body as Summary;
  const edit = (
    agent: TestAgent,
    id: string,
    quantity: string,
    overrides: object = {},
  ) =>
    agent.patch(`/orders/${id}`).send({
      quantity,
      paymentMethod: 'pay_on_delivery',
      deliveryLocation: 'Tầng 7',
      ...overrides,
    });
  const expire = async (campaign: TestCampaign) => {
    await dataSource.query(
      `UPDATE campaigns SET order_deadline = now() - interval '1 minute' WHERE id = $1`,
      [campaign.id],
    );
    await redis.flushdb();
  };
  const speaker = () =>
    publish(inStockBody({ acceptsPrepaidQr: false, stockQuantity: '5' }));

  beforeAll(async () => {
    app = await createTestApp(identity);
    dataSource = app.get(DataSource);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await redis.flushdb();
    seller = await signIn(app, identity, 'seller');
    minh = await signIn(app, identity, 'minh');
    lan = await signIn(app, identity, 'lan');
    await seller.patch('/users/me').send(bank).expect(200);
    stall = await publish(stallBody());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /listings/:id/summary', () => {
    it('has one row per order with its quantity, and totals that add up', async () => {
      const a = await order(minh, '1.5');
      const b = await order(lan, '2', {
        deliveryLocation: 'Tầng 3',
        paymentMethod: 'prepaid_qr',
      });
      await seller.post(`/orders/${b.id}/confirm-payment`).expect(200);

      const result = await summary();

      expect(result.listing.unit).toBe('kg');
      expect(result.rows).toEqual([
        expect.objectContaining({
          orderId: a.id,
          buyer: { name: 'minh', email: 'minh@example.com' },
          deliveryLocation: 'Tầng 7',
          quantity: 1.5,
          totalAmount: 52500,
          paymentStatus: 'unpaid',
        }),
        expect.objectContaining({
          orderId: b.id,
          deliveryLocation: 'Tầng 3',
          quantity: 2,
          totalAmount: 70000,
          paymentStatus: 'paid',
        }),
      ]);
      expect(result.totals).toEqual({
        orderCount: 2,
        quantity: 3.5,
        totalAmount: 122500,
        paidAmount: 70000,
        outstandingAmount: 52500,
      });
    });

    it('is empty but well-formed before anyone orders', async () => {
      const result = await summary();

      expect(result.rows).toEqual([]);
      expect(result.totals).toEqual({
        orderCount: 0,
        quantity: 0,
        totalAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
      });
    });

    it('leaves cancelled orders out of rows and totals unless asked, and never totals them', async () => {
      const kept = await order(minh, '1');
      const dropped = await order(lan, '4');
      await lan.post(`/orders/${dropped.id}/cancel`).send({}).expect(200);

      const normal = await summary();
      const withCancelled = await summary('?includeCancelled=true');

      expect(normal.rows.map((r) => r.orderId)).toEqual([kept.id]);
      expect(withCancelled.rows.map((r) => r.orderId)).toEqual([
        kept.id,
        dropped.id,
      ]);
      for (const result of [normal, withCancelled]) {
        expect(result.totals).toMatchObject({
          orderCount: 1,
          quantity: 1,
          totalAmount: 35000,
        });
      }
    });

    it('is only for the seller of the listing', async () => {
      await minh.get(`/listings/${stall.id}/summary`).expect(403);
      await minh.get(`/listings/${stall.id}/summary.csv`).expect(403);
      await minh
        .post(`/listings/${stall.id}/orders/bulk`)
        .send({ action: 'deliver', orderIds: [randomUUID()] })
        .expect(403);
      await seller.get(`/listings/${randomUUID()}/summary`).expect(404);
    });

    it('does not exist for a product of a pre-order round', async () => {
      // The round has its own summary: test/campaign-orders.e2e-spec.ts.
      const item = itemOf(await openRound());
      const placed = await order(minh, '1', {}, item);

      await seller.get(`/listings/${item.id}/summary`).expect(404);
      await seller.get(`/listings/${item.id}/summary.csv`).expect(404);
      await seller
        .post(`/listings/${item.id}/orders/bulk`)
        .send({ action: 'deliver', orderIds: [placed.id] })
        .expect(404);
    });
  });

  describe('GET /listings/:id/summary.csv', () => {
    const download = (agent: TestAgent) =>
      agent
        .get(`/listings/${stall.id}/summary.csv`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);

    it('downloads the same data as a spreadsheet-ready file', async () => {
      await order(minh, '1.5', { note: '=1+1' });
      await order(lan, '2', { deliveryLocation: 'Tầng 3, khu B' });

      const response = await download(seller);

      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="ssmarket-cam-sanh-tuan-41-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      const body = response.body as Buffer;
      expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const lines = body
        .toString('utf8')
        .replace(/^﻿/, '')
        .trimEnd()
        .split('\r\n');
      expect(lines[0]).toContain('Nơi giao,Số lượng (kg),Tổng tiền');
      expect(lines[1]).toContain('minh,minh@example.com,Tầng 7,1.5,52500');
      expect(lines[1]).toContain("'=1+1");
      expect(lines[2]).toContain('"Tầng 3, khu B",2,70000');
      expect(lines[3]).toBe('Tổng,2 đơn,,,3.5,122500,,,,,');
    });

    it('uses the language stored on the seller', async () => {
      await order(minh, '1');
      await seller.patch('/users/me').send({ locale: 'en' }).expect(200);

      const response = await download(seller);

      const first = (response.body as Buffer)
        .toString('utf8')
        .replace(/^﻿/, '')
        .split('\r\n')[0];
      expect(first.startsWith('Order code,Buyer,Email,Deliver to')).toBe(true);
      expect(first).toContain('Quantity (kg)');
    });
  });

  describe('POST /listings/:id/orders/bulk', () => {
    it('applies the action to each order and reports the ones it could not', async () => {
      const a = await order(minh, '1');
      const b = await order(lan, '1');
      await seller.post(`/orders/${b.id}/deliver`).expect(200);
      const elsewhere = await publish(stallBody({ title: 'Quầy khác nữa' }));
      const foreign = await order(minh, '1', {}, elsewhere);
      const unknown = randomUUID();

      const response = await seller
        .post(`/listings/${stall.id}/orders/bulk`)
        .send({
          action: 'deliver',
          orderIds: [a.id, b.id, foreign.id, unknown, a.id],
        })
        .expect(200);

      expect((response.body as { results: unknown[] }).results).toEqual([
        { orderId: a.id, ok: true, code: null },
        { orderId: b.id, ok: false, code: 'INVALID_ORDER_STATE' },
        { orderId: foreign.id, ok: false, code: 'NOT_IN_LISTING' },
        { orderId: unknown, ok: false, code: 'NOT_IN_LISTING' },
      ]);
      const after = await summary();
      expect(after.rows.map((r) => r.fulfillmentStatus)).toEqual([
        'delivered',
        'delivered',
      ]);
      const untouched = await minh.get(`/orders/${foreign.id}`).expect(200);
      expect(untouched.body).toMatchObject({ fulfillmentStatus: 'pending' });
    });

    it('confirms many payments at once', async () => {
      const a = await order(minh, '1');
      const b = await order(lan, '2');

      await seller
        .post(`/listings/${stall.id}/orders/bulk`)
        .send({ action: 'confirm_payment', orderIds: [a.id, b.id] })
        .expect(200);

      expect((await summary()).totals).toMatchObject({
        paidAmount: 105000,
        outstandingAmount: 0,
      });
    });

    it('validates the request', async () => {
      const post = (body: object) =>
        seller.post(`/listings/${stall.id}/orders/bulk`).send(body);

      await post({ action: 'refund', orderIds: [randomUUID()] }).expect(400);
      await post({ action: 'deliver', orderIds: [] }).expect(400);
      await post({ action: 'deliver', orderIds: ['not-a-uuid'] }).expect(400);
      await post({
        action: 'deliver',
        orderIds: Array.from({ length: 201 }, () => randomUUID()),
      }).expect(400);
    });
  });

  // Until orders hold several products of a round, a pre-order has one line
  // and is edited by its quantity. The multi-line scenarios and the summary
  // of a round live in test/campaign-orders.e2e-spec.ts.
  describe('PATCH /orders/:id', () => {
    let campaign: TestCampaign;
    let round: Listing;

    beforeEach(async () => {
      campaign = await openRound();
      round = itemOf(campaign);
    });

    it('changes the quantity and details, and recomputes the total', async () => {
      const placed = await order(minh, '1', {}, round);

      const response = await edit(minh, placed.id, '2.5', {
        deliveryLocation: 'Tầng 9',
        note: 'Giao buổi chiều',
      }).expect(200);

      expect(response.body).toMatchObject({
        code: placed.code,
        totalAmount: 87500,
        deliveryLocation: 'Tầng 9',
        note: 'Giao buổi chiều',
        lines: [{ title: 'Cam sành tuần 41', quantity: 2.5, lineTotal: 87500 }],
      });
      const reread = await seller.get(`/orders/${placed.id}`).expect(200);
      expect(reread.body).toMatchObject({
        totalAmount: 87500,
        campaign: { id: campaign.id },
        listing: { id: round.id, title: 'Cam sành tuần 41' },
      });
    });

    it('keeps the price the order was placed at', async () => {
      const placed = await order(minh, '1', {}, round);
      await seller
        .patch(`/campaigns/${campaign.id}`)
        .send(
          campaignBody({
            title: campaign.title,
            acceptsPrepaidQr: true,
            items: [
              itemBody({
                id: round.id,
                title: 'Cam sành loại một',
                unit: 'kg',
                unitPrice: 40000,
              }),
            ],
          }),
        )
        .expect(200);

      const response = await edit(minh, placed.id, '2').expect(200);

      expect((response.body as Order).lines).toEqual([
        expect.objectContaining({
          title: 'Cam sành tuần 41',
          unitPrice: 35000,
          quantity: 2,
        }),
      ]);
      expect((response.body as Order).totalAmount).toBe(70000);
    });

    it('updates the QR amount when a QR order changes', async () => {
      const placed = await order(
        minh,
        '1',
        { paymentMethod: 'prepaid_qr' },
        round,
      );
      expect(placed.qr?.amount).toBe(35000);

      const response = await edit(minh, placed.id, '3', {
        paymentMethod: 'prepaid_qr',
      }).expect(200);

      expect((response.body as Order).qr?.amount).toBe(105000);
    });

    it.each([
      ['an empty quantity', '', 422],
      ['kg finer than 0.1', '1.25', 422],
      ['no quantity at all', undefined, 400],
    ])('rejects %s', async (_label, quantity, status) => {
      const placed = await order(minh, '1', {}, round);

      await edit(minh, placed.id, quantity as string).expect(status);

      const unchanged = await minh.get(`/orders/${placed.id}`).expect(200);
      expect(unchanged.body).toMatchObject({ totalAmount: 35000 });
    });

    const refusal = (response: { body: unknown }) =>
      response.body as { code: string; details: { reason: string } };

    it('still works while the product is no longer on sale', async () => {
      const placed = await order(minh, '1', {}, round);
      await seller
        .patch(`/campaigns/${campaign.id}`)
        .send(
          campaignBody({
            title: campaign.title,
            acceptsPrepaidQr: true,
            items: [
              itemBody({
                id: round.id,
                title: round.title,
                unit: 'kg',
                unitPrice: 35000,
                selling: false,
              }),
            ],
          }),
        )
        .expect(200);

      const response = await edit(minh, placed.id, '2').expect(200);

      expect((response.body as Order).totalAmount).toBe(70000);
    });

    it('is refused once the payment has been reported', async () => {
      const placed = await order(
        minh,
        '1',
        { paymentMethod: 'prepaid_qr' },
        round,
      );
      await minh.post(`/orders/${placed.id}/report-payment`).expect(200);

      const body = refusal(await edit(minh, placed.id, '2').expect(409));

      expect(body).toMatchObject({
        code: 'ORDER_NOT_EDITABLE',
        details: { reason: 'payment_reported' },
      });
    });

    it('is refused after the deadline and after the round is closed', async () => {
      const placed = await order(minh, '1', {}, round);
      const closedRound = await openRound('Cam sẽ đóng');
      const onClosed = await order(lan, '1', {}, itemOf(closedRound));
      await seller.post(`/campaigns/${closedRound.id}/close`).expect(200);
      await expire(campaign);

      expect(
        refusal(await edit(minh, placed.id, '2').expect(409)),
      ).toMatchObject({ details: { reason: 'deadline_passed' } });
      expect(
        refusal(await edit(lan, onClosed.id, '2').expect(409)),
      ).toMatchObject({ details: { reason: 'deadline_passed' } });
    });

    it('is refused for a cancelled order and for an in-stock order', async () => {
      const cancelled = await order(minh, '1', {}, round);
      await minh.post(`/orders/${cancelled.id}/cancel`).send({}).expect(200);
      const stock = await speaker();
      const inStock = await order(lan, '1', {}, stock);

      expect(
        refusal(await edit(minh, cancelled.id, '2').expect(409)),
      ).toMatchObject({ details: { reason: 'cancelled' } });
      expect(
        refusal(await edit(lan, inStock.id, '2').expect(409)),
      ).toMatchObject({ details: { reason: 'not_preorder' } });
    });

    it('is only for the buyer', async () => {
      const placed = await order(minh, '1', {}, round);

      await edit(seller, placed.id, '2').expect(403);
      await edit(lan, placed.id, '2').expect(404);
    });
  });

  // Reopening a finished round is an action on the round; its scenarios
  // belong to test/campaigns.e2e-spec.ts.
});
