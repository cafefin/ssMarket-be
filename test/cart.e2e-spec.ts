import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';

type Listing = { id: string; stockQuantity: number | null };
type PreviewOrder = {
  key: string;
  isPreorder: boolean;
  totalAmount: number;
  listTotal: number;
  paymentMethods: string[];
  lines: Array<{ listingId: string; lineTotal: number }>;
};

const bank = {
  bankBin: '970436',
  bankAccountNumber: '0123456789',
  bankAccountName: 'Nguyen Van An',
};

describe('Cart and checkout', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let sellerA: TestAgent;
  let sellerB: TestAgent;
  let buyer: TestAgent;

  const open = async (agent: TestAgent, body: object): Promise<Listing> => {
    const created = await agent.post('/listings').send(body).expect(201);
    const id = (created.body as Listing).id;
    return (await agent.post(`/listings/${id}/publish`).expect(200))
      .body as Listing;
  };
  const gadget = (
    agent: TestAgent,
    title: string,
    product: { unitPrice: number; stockQuantity: string; combos?: object[] },
    overrides: object = {},
  ) =>
    open(agent, {
      mode: 'in_stock',
      condition: 'good',
      title,
      categoryId: 4,
      // Only seller A has bank details for QR payments.
      acceptsPrepaidQr: agent === sellerA,
      acceptsPayOnDelivery: true,
      unit: 'cái',
      ...product,
      ...overrides,
    });
  const fruit = (agent: TestAgent) =>
    open(agent, {
      mode: 'preorder',
      title: 'Hoa quả tuần này',
      categoryId: 2,
      acceptsPrepaidQr: false,
      acceptsPayOnDelivery: true,
      orderDeadline: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      deliveryDate: new Date(Date.now() + 5 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      unit: 'kg',
      unitPrice: 35000,
    });
  const add = (listingId: string, quantity: string) =>
    buyer.put(`/cart/lines/${listingId}`).send({ quantity });
  const stockOf = async (listing: Listing, agent: TestAgent) =>
    ((await agent.get(`/listings/${listing.id}`).expect(200)).body as Listing)
      .stockQuantity;
  const countOrders = async (): Promise<number> => {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*) AS count FROM orders',
    );
    return Number(rows[0].count);
  };

  beforeAll(async () => {
    app = await createTestApp(identity);
    dataSource = app.get(DataSource);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await redis.flushdb();
    sellerA = await signIn(app, identity, 'seller-a');
    sellerB = await signIn(app, identity, 'seller-b');
    buyer = await signIn(app, identity, 'buyer');
    await sellerA.patch('/users/me').send(bank).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the cart', () => {
    it('requires a session', async () => {
      const { default: request } = await import('supertest');
      await request(app.getHttpServer()).get('/cart').expect(401);
    });

    it('keeps products grouped by seller with current prices', async () => {
      const pens = await gadget(sellerA, 'Bút bi Thiên Long', {
        unitPrice: 10000,
        stockQuantity: '500',
        combos: [{ quantity: '100', price: 900000 }],
      });
      const mouse = await gadget(sellerB, 'Chuột không dây', {
        unitPrice: 200000,
        stockQuantity: '2',
      });

      await add(pens.id, '120').expect(200);
      await add(mouse.id, '1').expect(200);
      await add(pens.id, '130').expect(200);

      const cart = (await buyer.get('/cart').expect(200)).body;
      expect(cart.lineCount).toBe(2);
      expect(cart.groups).toHaveLength(2);
      const penLine = cart.groups
        .flatMap((group: { lines: object[] }) => group.lines)
        .find((line: { listingId: string }) => line.listingId === pens.id);
      expect(penLine).toMatchObject({
        quantity: 130,
        lineTotal: 1_200_000,
        listTotal: 1_300_000,
        problem: null,
      });
      expect((await buyer.get('/cart/count').expect(200)).body).toEqual({
        count: 2,
      });

      await buyer.delete(`/cart/lines/${mouse.id}`).expect(200);
      expect((await buyer.get('/cart/count').expect(200)).body.count).toBe(1);
    });

    it('refuses own goods, closed listings and bad quantities', async () => {
      const mine = await gadget(buyer, 'Đồ của tôi', {
        unitPrice: 50000,
        stockQuantity: '1',
      });
      const own = await add(mine.id, '1').expect(422);
      expect(own.body.code).toBe('OWN_LISTING');

      const pens = await gadget(sellerA, 'Bút chì 2B', {
        unitPrice: 10000,
        stockQuantity: '5',
      });
      const half = await add(pens.id, '0.5').expect(422);
      expect(half.body.code).toBe('INVALID_QUANTITY');

      await sellerA.post(`/listings/${pens.id}/close`).expect(200);
      const closed = await add(pens.id, '1').expect(409);
      expect(closed.body.code).toBe('LISTING_NOT_OPEN');
    });

    it('refuses more than the stock that is left', async () => {
      const last = await gadget(sellerA, 'Loa cuối cùng', {
        unitPrice: 500000,
        stockQuantity: '1',
      });

      await add(last.id, '1').expect(200);
      const twice = await add(last.id, '2').expect(409);

      expect(twice.body).toMatchObject({
        code: 'OUT_OF_STOCK',
        details: { items: [{ listingId: last.id, available: 1 }] },
      });
      const cart = (await buyer.get('/cart').expect(200)).body;
      expect(cart.groups[0].lines[0].quantity).toBe(1);
    });

    it('flags a line whose listing closed or ran short after it was added', async () => {
      const pens = await gadget(sellerA, 'Bút chì 2B', {
        unitPrice: 10000,
        stockQuantity: '5',
      });
      await add(pens.id, '5').expect(200);
      await dataSource.query(
        'UPDATE listings SET stock_quantity = 2 WHERE id = $1',
        [pens.id],
      );
      let line = (await buyer.get('/cart').expect(200)).body.groups[0].lines[0];
      expect(line.problem).toBe('OUT_OF_STOCK');

      await sellerA.post(`/listings/${pens.id}/close`).expect(200);
      line = (await buyer.get('/cart').expect(200)).body.groups[0].lines[0];
      expect(line.problem).toBe('LISTING_NOT_OPEN');
    });
  });

  describe('checkout', () => {
    it('previews one order per seller and one per pre-order round', async () => {
      const speaker = await gadget(sellerA, 'Loa bluetooth', {
        unitPrice: 500000,
        stockQuantity: '3',
      });
      const cable = await gadget(
        sellerA,
        'Dây cáp',
        { unitPrice: 30000, stockQuantity: '9' },
        { acceptsPrepaidQr: false },
      );
      const oranges = await fruit(sellerA);
      const mouse = await gadget(sellerB, 'Chuột không dây', {
        unitPrice: 200000,
        stockQuantity: '2',
      });

      const preview = await buyer
        .post('/checkout/preview')
        .send({
          lines: [
            { listingId: speaker.id, quantity: '1' },
            { listingId: cable.id, quantity: '2' },
            { listingId: oranges.id, quantity: '1.5' },
            { listingId: mouse.id, quantity: '1' },
          ],
        })
        .expect(201);

      const orders = preview.body.orders as PreviewOrder[];
      expect(
        orders.map((order) => [order.isPreorder, order.totalAmount]),
      ).toEqual([
        [false, 560000],
        [true, 52500],
        [false, 200000],
      ]);
      // The cable only takes pay-on-delivery, so the seller's order does too;
      // seller B has no bank details, so no QR either.
      expect(orders.map((order) => order.paymentMethods)).toEqual([
        ['pay_on_delivery'],
        ['pay_on_delivery'],
        ['pay_on_delivery'],
      ]);
    });

    it('creates every order at once, takes stock and empties the cart', async () => {
      const speaker = await gadget(sellerA, 'Loa bluetooth', {
        unitPrice: 500000,
        stockQuantity: '3',
      });
      const mouse = await gadget(sellerB, 'Chuột không dây', {
        unitPrice: 200000,
        stockQuantity: '2',
      });
      await add(speaker.id, '2').expect(200);
      await add(mouse.id, '1').expect(200);
      const lines = [
        { listingId: speaker.id, quantity: '2' },
        { listingId: mouse.id, quantity: '1' },
      ];
      const preview = (
        await buyer.post('/checkout/preview').send({ lines }).expect(201)
      ).body.orders as PreviewOrder[];
      const key = randomUUID();
      const body = {
        lines,
        fromCart: true,
        orders: [
          {
            key: preview[0].key,
            paymentMethod: 'prepaid_qr',
            deliveryLocation: 'Tầng 7',
          },
          {
            key: preview[1].key,
            paymentMethod: 'pay_on_delivery',
            deliveryLocation: 'Tầng 7',
            note: 'Giao giờ trưa',
          },
        ],
      };

      const result = await buyer
        .post('/checkout')
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);

      expect(result.body.orders).toHaveLength(2);
      expect(result.body.orders[0]).toMatchObject({
        totalAmount: 1_000_000,
        paymentMethod: 'prepaid_qr',
        qr: { amount: 1_000_000 },
      });
      expect(result.body.orders[1]).toMatchObject({
        totalAmount: 200000,
        note: 'Giao giờ trưa',
        qr: null,
      });
      expect(await stockOf(speaker, sellerA)).toBe(1);
      expect(await stockOf(mouse, sellerB)).toBe(1);
      expect((await buyer.get('/cart/count').expect(200)).body.count).toBe(0);

      // The same key replays the same orders instead of creating more.
      const again = await buyer
        .post('/checkout')
        .set('Idempotency-Key', key)
        .send(body)
        .expect(200);
      expect(
        again.body.orders.map((order: { id: string }) => order.id),
      ).toEqual(result.body.orders.map((order: { id: string }) => order.id));
      expect(await countOrders()).toBe(2);
    });

    it('creates nothing when one line is short', async () => {
      const speaker = await gadget(sellerA, 'Loa bluetooth', {
        unitPrice: 500000,
        stockQuantity: '3',
      });
      const mouse = await gadget(sellerB, 'Chuột không dây', {
        unitPrice: 200000,
        stockQuantity: '1',
      });
      const lines = [
        { listingId: speaker.id, quantity: '2' },
        { listingId: mouse.id, quantity: '2' },
      ];
      const preview = (
        await buyer.post('/checkout/preview').send({ lines }).expect(201)
      ).body.orders as PreviewOrder[];

      const response = await buyer
        .post('/checkout')
        .set('Idempotency-Key', randomUUID())
        .send({
          lines,
          fromCart: false,
          orders: preview.map((order) => ({
            key: order.key,
            paymentMethod: 'pay_on_delivery',
            deliveryLocation: 'Tầng 7',
          })),
        })
        .expect(409);

      expect(response.body.code).toBe('OUT_OF_STOCK');
      expect(response.body.details.items).toEqual([
        { listingId: mouse.id, title: 'Chuột không dây', available: 1 },
      ]);
      expect(await countOrders()).toBe(0);
      expect(await stockOf(speaker, sellerA)).toBe(3);
    });

    it('asks to review again when the orders no longer match the preview', async () => {
      const speaker = await gadget(sellerA, 'Loa bluetooth', {
        unitPrice: 500000,
        stockQuantity: '3',
      });
      const response = await buyer
        .post('/checkout')
        .set('Idempotency-Key', randomUUID())
        .send({
          lines: [{ listingId: speaker.id, quantity: '1' }],
          fromCart: false,
          orders: [
            {
              key: 'seller:someone-else',
              paymentMethod: 'pay_on_delivery',
              deliveryLocation: 'Tầng 7',
            },
          ],
        })
        .expect(409);
      expect(response.body.code).toBe('CHECKOUT_CHANGED');
      expect(await countOrders()).toBe(0);
    });

    it('requires an idempotency key', async () => {
      const response = await buyer
        .post('/checkout')
        .send({ lines: [], orders: [], fromCart: false })
        .expect(400);
      expect(['IDEMPOTENCY_KEY_REQUIRED', 'VALIDATION_FAILED']).toContain(
        response.body.code,
      );
    });

    it('shows each listing only its part of a mixed order in the summary', async () => {
      const speaker = await gadget(sellerA, 'Loa bluetooth', {
        unitPrice: 500000,
        stockQuantity: '3',
      });
      const cable = await gadget(sellerA, 'Dây cáp', {
        unitPrice: 30000,
        stockQuantity: '9',
      });
      const lines = [
        { listingId: speaker.id, quantity: '1' },
        { listingId: cable.id, quantity: '2' },
      ];
      const [planned] = (
        await buyer.post('/checkout/preview').send({ lines }).expect(201)
      ).body.orders as PreviewOrder[];
      const result = await buyer
        .post('/checkout')
        .set('Idempotency-Key', randomUUID())
        .send({
          lines,
          fromCart: false,
          orders: [
            {
              key: planned.key,
              paymentMethod: 'pay_on_delivery',
              deliveryLocation: 'Tầng 3',
            },
          ],
        })
        .expect(201);
      expect(result.body.orders[0]).toMatchObject({
        totalAmount: 560000,
        listingCount: 2,
      });

      const summary = (
        await sellerA.get(`/listings/${cable.id}/summary`).expect(200)
      ).body;
      expect(summary.rows).toHaveLength(1);
      expect(summary.rows[0].totalAmount).toBe(60000);
      expect(summary.totals).toMatchObject({
        orderCount: 1,
        totalAmount: 60000,
      });
      const detail = (await buyer.get(`/listings/${cable.id}`).expect(200))
        .body;
      expect(detail.orderCount).toBe(1);
    });
  });
});
