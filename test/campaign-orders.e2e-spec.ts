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
  orderKey,
  publish,
  publishCampaign,
  type TestCampaign,
  type TestListing,
} from './utils/market.js';

type Order = {
  id: string;
  code: string;
  totalAmount: number;
  isPreorder: boolean;
  paymentStatus: string;
  campaign: { id: string } | null;
  qr: { amount: number } | null;
  lines: Array<{
    listingId: string;
    title: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    listTotal: number;
  }>;
};
type Failure = {
  code: string;
  details: { orderId?: string; reason?: string; listingId?: string };
};

const bank = {
  bankBin: '970436',
  bankAccountNumber: '0123456789',
  bankAccountName: 'Nguyen Van An',
};

describe('Orders of a pre-order round', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let seller: TestAgent;
  let minh: TestAgent;
  let lan: TestAgent;
  let quynh: TestAgent;
  let campaign: TestCampaign;
  let a: TestListing;
  let b: TestListing;
  let c: TestListing;

  const roundBody = (overrides: object = {}) =>
    campaignBody({
      acceptsPrepaidQr: true,
      items: [
        itemBody({ title: 'Bánh bao chay', unitPrice: 15000 }),
        itemBody({
          title: 'Bánh bao nhân thịt',
          unitPrice: 18000,
          combos: [{ quantity: '10', price: 160000 }],
        }),
        itemBody({ title: 'Bánh bao trứng cút', unitPrice: 22000 }),
      ],
      ...overrides,
    });
  /** Rewrites the round's products; `change` may edit or drop each one. */
  const rewrite = async (
    round: TestCampaign,
    change: (item: object, index: number) => object | null,
  ) => {
    const items = round.items
      .map((item, index) =>
        change(
          {
            id: item.id,
            title: item.title,
            unit: item.unit,
            unitPrice: item.unitPrice,
            combos:
              index === 1 ? [{ quantity: '10', price: 160000 }] : undefined,
            selling: item.selling,
          },
          index,
        ),
      )
      .filter((item) => item !== null);
    await seller
      .patch(`/campaigns/${round.id}`)
      .send({
        title: round.title,
        categoryId: 2,
        acceptsPrepaidQr: true,
        acceptsPayOnDelivery: true,
        orderDeadline: round.orderDeadline,
        deliveryDate: round.deliveryDate,
        items,
      })
      .expect(200);
  };
  const buy = async (
    agent: TestAgent,
    purchases: Array<[TestListing, string]>,
    choice: Choice = {},
  ): Promise<Order> =>
    (
      (
        await checkout(
          agent,
          purchases.map(([listing, quantity]) => ({ listing, quantity })),
          choice,
        ).expect(201)
      ).body as { orders: Order[] }
    ).orders[0];
  const edit = (
    agent: TestAgent,
    id: string,
    lines: Array<[TestListing, string]>,
    overrides: object = {},
  ) =>
    agent.patch(`/orders/${id}`).send({
      lines: lines.map(([listing, quantity]) => ({
        listingId: listing.id,
        quantity,
      })),
      paymentMethod: 'pay_on_delivery',
      deliveryLocation: 'Tầng 7',
      ...overrides,
    });
  const failure = (response: { body: unknown }) => response.body as Failure;
  const expire = async (round: TestCampaign) => {
    await dataSource.query(
      `UPDATE campaigns SET order_deadline = now() - interval '1 minute' WHERE id = $1`,
      [round.id],
    );
    await redis.flushdb();
  };

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
    quynh = await signIn(app, identity, 'quynh');
    await seller.patch('/users/me').send(bank).expect(200);
    campaign = await publishCampaign(seller, roundBody());
    [a, b, c] = [0, 1, 2].map((index) => itemOf(campaign, index));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('checkout', () => {
    it('creates one order with a line per product and one QR for the total', async () => {
      const placed = await buy(
        minh,
        [
          [a, '2'],
          [c, '1'],
        ],
        { paymentMethod: 'prepaid_qr' },
      );

      expect(placed).toMatchObject({
        isPreorder: true,
        totalAmount: 52000,
        campaign: { id: campaign.id },
        qr: { amount: 52000 },
      });
      expect(
        placed.lines.map((line) => [line.listingId, line.quantity]),
      ).toEqual([
        [a.id, 2],
        [c.id, 1],
      ]);
      const orders = await minh.get('/orders').expect(200);
      expect((orders.body as { items: Order[] }).items).toHaveLength(1);
    });

    it('charges a combo price and keeps the retail total beside it', async () => {
      const placed = await buy(minh, [[b, '10']]);

      expect(placed.totalAmount).toBe(160000);
      expect(placed.lines[0]).toMatchObject({
        lineTotal: 160000,
        listTotal: 180000,
      });
    });

    it('allows one live order per buyer in a round', async () => {
      const first = await buy(minh, [[a, '1']]);

      const again = failure(
        await checkout(minh, [{ listing: c, quantity: '1' }]).expect(409),
      );
      expect(again).toMatchObject({
        code: 'ALREADY_ORDERED',
        details: { orderId: first.id },
      });

      await buy(lan, [[a, '1']]);

      await minh.post(`/orders/${first.id}/cancel`).send({}).expect(200);
      await buy(minh, [[c, '1']]);
    });

    it('makes one order per round, and one apart from in-stock goods', async () => {
      const second = await publishCampaign(
        seller,
        roundBody({ title: 'Bánh bao tuần sau' }),
      );
      const other = itemOf(second, 0);
      const stock = await publish(seller, inStockBody());

      const response = await checkout(
        minh,
        [
          { listing: a, quantity: '1' },
          { listing: other, quantity: '1' },
          { listing: stock, quantity: '1' },
        ],
        { keys: [orderKey(a), orderKey(other), orderKey(stock)] },
      ).expect(201);

      const orders = (response.body as { orders: Order[] }).orders;
      expect(orders).toHaveLength(3);
      expect(orders.map((order) => order.isPreorder)).toEqual([
        true,
        true,
        false,
      ]);
      expect(orders.every((order) => order.lines.length === 1)).toBe(true);
    });

    it('refuses one order choice that covers two rounds', async () => {
      const second = await publishCampaign(
        seller,
        roundBody({ title: 'Bánh bao tuần sau' }),
      );

      const response = await checkout(minh, [
        { listing: a, quantity: '1' },
        { listing: itemOf(second, 0), quantity: '1' },
      ]).expect(409);

      expect(failure(response).code).toBe('CHECKOUT_CHANGED');
    });

    it('does not take a product that is no longer on sale', async () => {
      await rewrite(campaign, (item, index) =>
        index === 2 ? { ...item, selling: false } : item,
      );

      const response = await checkout(minh, [
        { listing: a, quantity: '1' },
        { listing: c, quantity: '1' },
      ]).expect(409);

      expect(failure(response)).toMatchObject({ code: 'LISTING_NOT_OPEN' });
    });

    it('accepts fifty lines', async () => {
      const big = await publishCampaign(
        seller,
        roundBody({
          title: 'Đợt năm mươi món',
          items: Array.from({ length: 50 }, (_, index) =>
            itemBody({ title: `Món số ${index + 1}`, unitPrice: 1000 }),
          ),
        }),
      );
      const everything = big.items.map((_, index) => ({
        listing: itemOf(big, index),
        quantity: '1',
      }));

      const response = await checkout(minh, everything).expect(201);

      const placed = (response.body as { orders: Order[] }).orders[0];
      expect(placed.lines).toHaveLength(50);
      expect(placed.totalAmount).toBe(50000);
    });
  });

  describe('PATCH /orders/:id', () => {
    it('replaces the lines: changes one, adds one, drops one', async () => {
      const placed = await buy(minh, [
        [a, '2'],
        [c, '1'],
      ]);

      const response = await edit(minh, placed.id, [
        [a, '3'],
        [b, '1'],
      ]).expect(200);

      const body = response.body as Order;
      expect(body.totalAmount).toBe(63000);
      expect(body.lines.map((line) => [line.listingId, line.quantity])).toEqual(
        [
          [a.id, 3],
          [b.id, 1],
        ],
      );
    });

    it('keeps the price an existing line was ordered at', async () => {
      const placed = await buy(minh, [[a, '2']]);
      await rewrite(campaign, (item, index) =>
        index === 0
          ? { ...item, unitPrice: 20000 }
          : index === 2
            ? { ...item, unitPrice: 25000 }
            : item,
      );

      const response = await edit(minh, placed.id, [
        [a, '4'],
        [c, '1'],
      ]).expect(200);

      const body = response.body as Order;
      expect(body.lines[0]).toMatchObject({
        unitPrice: 15000,
        lineTotal: 60000,
      });
      expect(body.lines[1]).toMatchObject({
        unitPrice: 25000,
        lineTotal: 25000,
      });
      expect(body.totalAmount).toBe(85000);
    });

    it('updates the QR amount and the details', async () => {
      const placed = await buy(minh, [[a, '1']], {
        paymentMethod: 'prepaid_qr',
      });
      expect(placed.qr?.amount).toBe(15000);

      const response = await edit(
        minh,
        placed.id,
        [
          [a, '1'],
          [b, '10'],
        ],
        {
          paymentMethod: 'prepaid_qr',
          deliveryLocation: 'Tầng 9',
          note: 'Giao buổi chiều',
        },
      ).expect(200);

      expect(response.body).toMatchObject({
        code: placed.code,
        totalAmount: 175000,
        deliveryLocation: 'Tầng 9',
        note: 'Giao buổi chiều',
        qr: { amount: 175000 },
      });
    });

    it('refuses a payment method the round does not accept', async () => {
      const cashOnly = await publishCampaign(
        seller,
        roundBody({ title: 'Bánh bao trả sau', acceptsPrepaidQr: false }),
      );
      const item = itemOf(cashOnly, 0);
      const placed = await buy(minh, [[item, '1']]);

      const response = await edit(minh, placed.id, [[item, '2']], {
        paymentMethod: 'prepaid_qr',
      }).expect(422);

      expect(failure(response).code).toBe('PAYMENT_METHOD_NOT_ACCEPTED');
      const unchanged = await minh.get(`/orders/${placed.id}`).expect(200);
      expect(unchanged.body).toMatchObject({
        totalAmount: 15000,
        paymentMethod: 'pay_on_delivery',
      });
    });

    it('refuses products outside the round, and repeated ones', async () => {
      const placed = await buy(minh, [[a, '1']]);
      const second = await publishCampaign(
        seller,
        roundBody({ title: 'Bánh bao tuần sau' }),
      );
      const stock = await publish(seller, inStockBody());

      await edit(minh, placed.id, [[itemOf(second, 0), '1']]).expect(400);
      await edit(minh, placed.id, [[stock, '1']]).expect(400);
      await edit(minh, placed.id, [
        [a, '1'],
        [a, '2'],
      ]).expect(400);
      await edit(minh, placed.id, [
        [{ ...a, id: '6f9619ff-8b86-4011-b42d-00c04fc964ff' }, '1'],
      ]).expect(400);

      const unchanged = await minh.get(`/orders/${placed.id}`).expect(200);
      expect(unchanged.body).toMatchObject({ totalAmount: 15000 });
    });

    it('rejects a malformed quantity or an empty list', async () => {
      const placed = await buy(minh, [[a, '1']]);

      await edit(minh, placed.id, [[a, '']]).expect(422);
      await edit(minh, placed.id, [[a, '1.5']]).expect(422);
      await edit(minh, placed.id, []).expect(400);
      await minh
        .patch(`/orders/${placed.id}`)
        .send({
          quantity: '2',
          paymentMethod: 'pay_on_delivery',
          deliveryLocation: 'Tầng 7',
        })
        .expect(400);
    });

    it('accepts fifty lines', async () => {
      const big = await publishCampaign(
        seller,
        roundBody({
          title: 'Đợt năm mươi món',
          items: Array.from({ length: 50 }, (_, index) =>
            itemBody({ title: `Món số ${index + 1}`, unitPrice: 1000 }),
          ),
        }),
      );
      const items = big.items.map((_, index) => itemOf(big, index));
      const placed = await buy(
        minh,
        items.slice(0, 1).map((item) => [item, '1'] as [TestListing, string]),
      );

      const response = await edit(
        minh,
        placed.id,
        items.map((item) => [item, '2'] as [TestListing, string]),
      ).expect(200);

      expect((response.body as Order).lines).toHaveLength(50);
      expect((response.body as Order).totalAmount).toBe(100000);
    });

    describe('a product that is no longer on sale', () => {
      let placed: Order;

      beforeEach(async () => {
        placed = await buy(minh, [
          [a, '2'],
          [c, '1'],
        ]);
        await rewrite(campaign, (item, index) =>
          index === 0 || index === 1 ? { ...item, selling: false } : item,
        );
      });

      it('cannot be added', async () => {
        const response = await edit(minh, placed.id, [
          [a, '2'],
          [b, '1'],
        ]).expect(409);

        expect(failure(response)).toMatchObject({
          code: 'LISTING_NOT_OPEN',
          details: { listingId: b.id },
        });
      });

      it('cannot be raised', async () => {
        const response = await edit(minh, placed.id, [[a, '3']]).expect(409);

        expect(failure(response).code).toBe('LISTING_NOT_OPEN');
      });

      it('can be kept or lowered', async () => {
        await edit(minh, placed.id, [
          [a, '2.0'],
          [c, '2'],
        ]).expect(200);
        const response = await edit(minh, placed.id, [
          [a, '1'],
          [c, '2'],
        ]).expect(200);

        expect((response.body as Order).totalAmount).toBe(15000 + 44000);
      });
    });

    describe('is refused', () => {
      it('after payment was reported', async () => {
        const placed = await buy(minh, [[a, '1']], {
          paymentMethod: 'prepaid_qr',
        });
        await minh.post(`/orders/${placed.id}/report-payment`).expect(200);

        const response = await edit(minh, placed.id, [[a, '2']]).expect(409);

        expect(failure(response)).toMatchObject({
          code: 'ORDER_NOT_EDITABLE',
          details: { reason: 'payment_reported' },
        });
      });

      it('after the deadline and after the seller closes the round', async () => {
        const placed = await buy(minh, [[a, '1']]);
        const closing = await publishCampaign(
          seller,
          roundBody({ title: 'Đợt sẽ đóng' }),
        );
        const onClosing = await buy(lan, [[itemOf(closing, 0), '1']]);
        await seller.post(`/campaigns/${closing.id}/close`).expect(200);
        await expire(campaign);

        const late = await edit(minh, placed.id, [[a, '2']]).expect(409);
        const closed = await edit(lan, onClosing.id, [
          [itemOf(closing, 0), '2'],
        ]).expect(409);

        expect(failure(late).details.reason).toBe('deadline_passed');
        expect(failure(closed).details.reason).toBe('deadline_passed');
      });
    });

    it('is refused for a cancelled order and for an in-stock order', async () => {
      const cancelled = await buy(minh, [[a, '1']]);
      await minh.post(`/orders/${cancelled.id}/cancel`).send({}).expect(200);
      const stock = await publish(seller, inStockBody());
      const inStock = await buy(lan, [[stock, '1']]);

      const first = await edit(minh, cancelled.id, [[a, '2']]).expect(409);
      const second = await edit(lan, inStock.id, [[stock, '2']]).expect(409);

      expect(failure(first).details.reason).toBe('cancelled');
      expect(failure(second).details.reason).toBe('not_preorder');
    });

    it('is only for the buyer', async () => {
      const placed = await buy(minh, [[a, '1']]);

      await edit(seller, placed.id, [[a, '2']]).expect(403);
      await edit(lan, placed.id, [[a, '2']]).expect(404);
    });
  });

  describe('the seller’s view of the round', () => {
    type Table = {
      campaign: { id: string };
      items: Array<{ listingId: string; title: string; unit: string }>;
      rows: Array<{
        orderId: string;
        buyer: { name: string };
        quantities: number[];
        totalAmount: number;
        fulfillmentStatus: string;
      }>;
      itemTotals: number[];
      totals: {
        orderCount: number;
        totalAmount: number;
        paidAmount: number;
        outstandingAmount: number;
      };
    };
    type Results = {
      results: Array<{ orderId: string; ok: boolean; code: string | null }>;
    };
    let forMinh: Order;
    let forLan: Order;
    let cancelled: Order;

    beforeEach(async () => {
      forMinh = await buy(
        minh,
        [
          [a, '2'],
          [c, '1'],
        ],
        { paymentMethod: 'prepaid_qr', note: '=1+1' },
      );
      forLan = await buy(lan, [[b, '10']]);
      cancelled = await buy(quynh, [[a, '1']]);
      await quynh.post(`/orders/${cancelled.id}/cancel`).send({}).expect(200);
    });

    const table = async (query = '') =>
      (
        await seller
          .get(`/campaigns/${campaign.id}/summary${query}`)
          .expect(200)
      ).body as Table;

    describe('GET /campaigns/:id/summary', () => {
      it('has a column per product, a row per live order and SQL totals', async () => {
        const body = await table();

        expect(body.campaign.id).toBe(campaign.id);
        expect(body.items.map((item) => item.title)).toEqual([
          'Bánh bao chay',
          'Bánh bao nhân thịt',
          'Bánh bao trứng cút',
        ]);
        expect(body.rows.map((row) => row.orderId)).toEqual([
          forMinh.id,
          forLan.id,
        ]);
        expect(body.rows.map((row) => row.quantities)).toEqual([
          [2, 0, 1],
          [0, 10, 0],
        ]);
        expect(body.itemTotals).toEqual([2, 10, 1]);
        expect(body.totals).toEqual({
          orderCount: 2,
          totalAmount: 212000,
          paidAmount: 0,
          outstandingAmount: 212000,
        });
      });

      it('shows cancelled orders on request without counting them', async () => {
        const body = await table('?includeCancelled=true');

        expect(body.rows).toHaveLength(3);
        expect(body.rows[2]).toMatchObject({
          orderId: cancelled.id,
          fulfillmentStatus: 'cancelled',
        });
        expect(body.itemTotals).toEqual([2, 10, 1]);
        expect(body.totals.orderCount).toBe(2);
        expect(body.totals.totalAmount).toBe(212000);
      });

      it('counts a payment once the seller confirms it', async () => {
        await seller.post(`/orders/${forMinh.id}/confirm-payment`).expect(200);

        const { totals } = await table();

        expect(totals.paidAmount).toBe(52000);
        expect(totals.outstandingAmount).toBe(160000);
      });

      it('keeps a stopped product that was ordered and drops one nobody ordered', async () => {
        await rewrite(campaign, (item, index) =>
          index === 0 || index === 1 ? { ...item, selling: false } : item,
        );
        await lan.post(`/orders/${forLan.id}/cancel`).send({}).expect(200);
        // A and C are ordered by Minh; B was ordered only by the cancelled Lan.
        const body = await table();

        expect(body.items.map((item) => item.listingId)).toEqual([a.id, c.id]);
        expect(body.rows[0].quantities).toEqual([2, 1]);
        expect(body.itemTotals).toEqual([2, 1]);
      });

      it('is only for the seller of the round', async () => {
        await minh.get(`/campaigns/${campaign.id}/summary`).expect(403);
        await seller.get(`/campaigns/${randomUUID()}/summary`).expect(404);
        await seller.get('/campaigns/not-a-uuid/summary').expect(400);
      });
    });

    describe('GET /campaigns/:id/summary.csv', () => {
      const download = (agent: TestAgent) =>
        agent
          .get(`/campaigns/${campaign.id}/summary.csv`)
          .buffer(true)
          .parse((res, done) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => done(null, Buffer.concat(chunks)));
          })
          .expect(200);
      const linesOf = (body: Buffer) =>
        body.toString('utf8').replace(/^﻿/, '').trimEnd().split('\r\n');

      it('downloads the table as a spreadsheet-ready file', async () => {
        const response = await download(seller);

        expect(response.headers['content-type']).toBe(
          'text/csv; charset=utf-8',
        );
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['content-disposition']).toMatch(
          /^attachment; filename="ssmarket-banh-bao-tuan-nay-\d{4}-\d{2}-\d{2}\.csv"$/,
        );
        const body = response.body as Buffer;
        expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        const lines = linesOf(body);
        expect(lines[0]).toContain(
          'Mã đơn,Người mua,Email,Nơi giao,Bánh bao chay (cái),Bánh bao nhân thịt (cái),Bánh bao trứng cút (cái),Tổng tiền,',
        );
        expect(lines[1]).toContain(',2,0,1,52000,');
        expect(lines[1]).toContain("'=1+1");
        expect(lines[2]).toContain(',0,10,0,160000,');
        expect(lines).toHaveLength(6);
        expect(lines[3]).toContain('Tổng,2 đơn,,,2,10,1,212000');
      });

      it('is written in the seller’s language', async () => {
        await seller.patch('/users/me').send({ locale: 'en' }).expect(200);

        const lines = linesOf((await download(seller)).body as Buffer);

        expect(lines[0]).toMatch(/^Order code,Buyer,Email,Deliver to,/);
      });

      it('is only for the seller of the round', async () => {
        await minh.get(`/campaigns/${campaign.id}/summary.csv`).expect(403);
      });
    });

    describe('POST /campaigns/:id/orders/bulk', () => {
      it('runs each order alone and reports the one from another round', async () => {
        const second = await publishCampaign(
          seller,
          roundBody({ title: 'Bánh bao tuần sau' }),
        );
        const elsewhere = await buy(minh, [[itemOf(second, 0), '1']]);

        const response = await seller
          .post(`/campaigns/${campaign.id}/orders/bulk`)
          .send({
            action: 'deliver',
            orderIds: [forMinh.id, forLan.id, elsewhere.id],
          })
          .expect(200);

        expect((response.body as Results).results).toEqual([
          { orderId: forMinh.id, ok: true, code: null },
          { orderId: forLan.id, ok: true, code: null },
          { orderId: elsewhere.id, ok: false, code: 'NOT_IN_CAMPAIGN' },
        ]);
        const delivered = await seller.get(`/orders/${forMinh.id}`).expect(200);
        expect(delivered.body).toMatchObject({
          fulfillmentStatus: 'delivered',
        });
      });

      it('is only for the seller of the round', async () => {
        await minh
          .post(`/campaigns/${campaign.id}/orders/bulk`)
          .send({ action: 'deliver', orderIds: [forMinh.id] })
          .expect(403);
      });
    });

    describe('GET /campaigns/:id/my-order', () => {
      it('tells a buyer whether they already ordered', async () => {
        const mine = await minh.get(`/campaigns/${campaign.id}/my-order`);
        const other = await seller.get(`/campaigns/${campaign.id}/my-order`);
        const gone = await quynh.get(`/campaigns/${campaign.id}/my-order`);

        expect(mine.body).toEqual({ orderId: forMinh.id });
        expect(other.body).toEqual({ orderId: null });
        expect(gone.body).toEqual({ orderId: null });
      });

      it('answers 404 for a missing round and for a draft', async () => {
        const draft = await seller
          .post('/campaigns')
          .send(campaignBody())
          .expect(201);

        await minh.get(`/campaigns/${randomUUID()}/my-order`).expect(404);
        await minh
          .get(`/campaigns/${(draft.body as TestCampaign).id}/my-order`)
          .expect(404);
      });
    });
  });
});
