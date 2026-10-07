import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';

type Item = {
  id: string;
  name: string;
  stockQuantity: number | null;
  combos?: Array<{ quantity: string; price: number }>;
};
type Listing = { id: string; title?: string; items: Item[] };
type Order = {
  id: string;
  code: string;
  totalAmount: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  viewerRole: string;
  refundNeeded: boolean;
  qr: null | {
    payload: string;
    amount: number;
    content: string;
    accountNumber: string;
    bankName: string;
  };
  lines: Array<{
    itemName: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
};

const bank = {
  bankBin: '970436',
  bankAccountNumber: '0123456789',
  bankAccountName: 'Nguyen Van An',
};

describe('Orders API', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let seller: TestAgent;
  let buyer: TestAgent;
  let other: TestAgent;

  const createListing = async (body: object): Promise<Listing> => {
    const created = await seller.post('/listings').send(body).expect(201);
    const id = (created.body as Listing).id;
    const published = await seller.post(`/listings/${id}/publish`).expect(200);
    return published.body as Listing;
  };
  const inStock = (overrides: object = {}) =>
    createListing({
      mode: 'in_stock',
      condition: 'good',
      title: 'Loa và phụ kiện',
      categoryId: 4,
      acceptsPrepaidQr: true,
      acceptsPayOnDelivery: true,
      items: [
        { name: 'Loa', unit: 'cái', unitPrice: 500000, stockQuantity: '3' },
        { name: 'Cam', unit: 'kg', unitPrice: 35000, stockQuantity: '10' },
      ],
      ...overrides,
    });
  const preorder = () =>
    createListing({
      mode: 'preorder',
      title: 'Hoa quả tuần này',
      categoryId: 2,
      acceptsPrepaidQr: true,
      acceptsPayOnDelivery: true,
      orderDeadline: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      deliveryDate: new Date(Date.now() + 5 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      items: [{ name: 'Cam sành', unit: 'kg', unitPrice: 35000 }],
    });
  const item = (listing: Listing, name: string) =>
    listing.items.find((candidate) => candidate.name === name)!;

  const place = (
    agent: TestAgent,
    listing: Listing,
    lines: Array<[string, string]>,
    overrides: Record<string, unknown> = {},
    key: string = randomUUID(),
  ) =>
    agent
      .post('/orders')
      .set('Idempotency-Key', key)
      .send({
        listingId: listing.id,
        lines: lines.map(([name, quantity]) => ({
          itemId: item(listing, name).id,
          quantity,
        })),
        paymentMethod: 'pay_on_delivery',
        deliveryLocation: 'Tầng 7',
        ...overrides,
      });
  const order = async (
    listing: Listing,
    lines: Array<[string, string]>,
    overrides: Record<string, unknown> = {},
    agent: TestAgent = buyer,
  ): Promise<Order> =>
    (await place(agent, listing, lines, overrides).expect(201)).body as Order;

  const stockOf = async (listing: Listing, name: string): Promise<number> => {
    const response = await seller.get(`/listings/${listing.id}`).expect(200);
    return item(response.body as Listing, name).stockQuantity as number;
  };
  const countOrders = async (): Promise<number> => {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*) AS count FROM orders',
    );
    return Number(rows[0].count);
  };
  const act = (
    agent: TestAgent,
    id: string,
    action: string,
    body: object = {},
  ) => agent.post(`/orders/${id}/${action}`).send(body);

  beforeAll(async () => {
    app = await createTestApp(identity);
    dataSource = app.get(DataSource);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await redis.flushdb();
    seller = await signIn(app, identity, 'seller');
    buyer = await signIn(app, identity, 'buyer');
    other = await signIn(app, identity, 'other');
    await seller.patch('/users/me').send(bank).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('placing an order', () => {
    it('charges combo prices and keeps them on the order line', async () => {
      const listing = await inStock({
        items: [
          {
            name: 'Bút bi',
            unit: 'cái',
            unitPrice: 10000,
            stockQuantity: '500',
            combos: [{ quantity: '100', price: 900000 }],
          },
        ],
      });
      expect(item(listing, 'Bút bi')).toMatchObject({
        combos: [{ quantity: '100', price: 900000 }],
      });

      const placed = await order(listing, [['Bút bi', '230']]);

      expect(placed.totalAmount).toBe(2_100_000);
      expect(placed.lines[0]).toMatchObject({
        lineTotal: 2_100_000,
        listTotal: 2_300_000,
        combos: [{ quantity: '100', price: 900000 }],
      });

      // A later change to the listing does not reprice the order.
      await seller
        .patch(`/listings/${listing.id}`)
        .send({
          mode: 'in_stock',
          condition: 'good',
          title: listing.title,
          categoryId: 4,
          acceptsPrepaidQr: true,
          acceptsPayOnDelivery: true,
          items: [
            {
              id: item(listing, 'Bút bi').id,
              name: 'Bút bi',
              unit: 'cái',
              unitPrice: 10000,
              stockQuantity: '270',
            },
          ],
        })
        .expect(200);
      const again = await buyer.get(`/orders/${placed.id}`).expect(200);
      expect(again.body.totalAmount).toBe(2_100_000);
      const edited = await seller.get(`/listings/${listing.id}`).expect(200);
      expect(item(edited.body as Listing, 'Bút bi').combos).toEqual([]);
    });

    it('prices the lines from the listing and takes them out of stock', async () => {
      const listing = await inStock();

      const response = await place(buyer, listing, [
        ['Loa', '2'],
        ['Cam', '1.5'],
      ]).expect(201);

      const placed = response.body as Order;
      expect(placed.code).toMatch(/^SSM[2-9A-HJ-NP-Z]{6}$/);
      expect(placed).toMatchObject({
        totalAmount: 1052500,
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'pending',
        viewerRole: 'buyer',
        deliveryLocation: 'Tầng 7',
        isPreorder: false,
        qr: null,
        lines: [
          {
            itemName: 'Loa',
            unitPrice: 500000,
            quantity: 2,
            lineTotal: 1000000,
          },
          {
            itemName: 'Cam',
            unitPrice: 35000,
            quantity: 1.5,
            lineTotal: 52500,
          },
        ],
      });
      expect(await stockOf(listing, 'Loa')).toBe(1);
      expect(await stockOf(listing, 'Cam')).toBe(8.5);
    });

    it('shows the reduced stock to buyers straight away', async () => {
      const listing = await inStock();
      await buyer.get(`/listings/${listing.id}`).expect(200);

      await order(listing, [['Loa', '1']]);

      const seen = await other.get(`/listings/${listing.id}`).expect(200);
      expect(item(seen.body as Listing, 'Loa').stockQuantity).toBe(2);
    });

    it('ignores any price or total sent by the client', async () => {
      const listing = await inStock();

      await place(buyer, listing, [['Loa', '1']], { totalAmount: 1 }).expect(
        400,
      );
      const response = await buyer
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send({
          listingId: listing.id,
          lines: [
            { itemId: item(listing, 'Loa').id, quantity: '1', unitPrice: 1 },
          ],
          paymentMethod: 'pay_on_delivery',
          deliveryLocation: 'Tầng 7',
        })
        .expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await countOrders()).toBe(0);
    });

    it('never sells more than the stock when buyers order at the same time', async () => {
      const listing = await inStock();
      const buyers = await Promise.all(
        Array.from({ length: 10 }, (_, i) => signIn(app, identity, `b${i}`)),
      );

      const responses = await Promise.all(
        buyers.map((agent) => place(agent, listing, [['Loa', '1']])),
      );

      const statuses = responses
        .map((response) => response.status)
        .sort((a, b) => a - b);
      expect(statuses).toEqual([
        201, 201, 201, 409, 409, 409, 409, 409, 409, 409,
      ]);
      const refused = responses.find((response) => response.status === 409)!;
      expect(refused.body).toMatchObject({
        code: 'OUT_OF_STOCK',
        details: { items: [{ name: 'Loa', available: 0 }] },
      });
      expect(await stockOf(listing, 'Loa')).toBe(0);
      expect(await countOrders()).toBe(3);
    });

    it('leaves stock untouched when one line of the order is short', async () => {
      const listing = await inStock();

      const response = await place(buyer, listing, [
        ['Cam', '2'],
        ['Loa', '4'],
      ]).expect(409);

      expect(response.body).toMatchObject({
        code: 'OUT_OF_STOCK',
        details: { items: [{ name: 'Loa', available: 3 }] },
      });
      expect(await stockOf(listing, 'Cam')).toBe(10);
      expect(await countOrders()).toBe(0);
    });

    it('creates one order when the same request is sent twice', async () => {
      const listing = await inStock();
      const key = randomUUID();

      const first = await place(buyer, listing, [['Loa', '1']], {}, key).expect(
        201,
      );
      const second = await place(
        buyer,
        listing,
        [['Loa', '1']],
        {},
        key,
      ).expect(200);

      expect((second.body as Order).id).toBe((first.body as Order).id);
      expect(await countOrders()).toBe(1);
      expect(await stockOf(listing, 'Loa')).toBe(2);
    });

    it('lets a failed request be retried with the same key', async () => {
      const listing = await inStock();
      const key = randomUUID();

      await place(buyer, listing, [['Loa', '9']], {}, key).expect(409);
      await place(buyer, listing, [['Loa', '1']], {}, key).expect(201);
    });

    it('requires an idempotency key', async () => {
      const listing = await inStock();

      const response = await buyer
        .post('/orders')
        .send({
          listingId: listing.id,
          lines: [{ itemId: item(listing, 'Loa').id, quantity: '1' }],
          paymentMethod: 'pay_on_delivery',
          deliveryLocation: 'Tầng 7',
        })
        .expect(400);

      expect(response.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    });

    it.each([
      ['a fraction of a piece', 'Loa', '1.5'],
      ['zero', 'Loa', '0'],
      ['kg finer than 0.1', 'Cam', '0.25'],
      ['text', 'Loa', 'hai'],
    ])('rejects %s as a quantity', async (_label, name, quantity) => {
      const listing = await inStock();

      const response = await place(buyer, listing, [[name, quantity]]).expect(
        422,
      );

      expect(response.body).toMatchObject({ code: 'INVALID_QUANTITY' });
    });

    it('rejects an item of another listing and a repeated item', async () => {
      const listing = await inStock();
      const elsewhere = await preorder();

      const foreign = await buyer
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send({
          listingId: listing.id,
          lines: [{ itemId: elsewhere.items[0].id, quantity: '1' }],
          paymentMethod: 'pay_on_delivery',
          deliveryLocation: 'Tầng 7',
        })
        .expect(422);
      expect(foreign.body).toMatchObject({ code: 'INVALID_QUANTITY' });

      await place(buyer, listing, [
        ['Loa', '1'],
        ['Loa', '1'],
      ]).expect(422);
    });

    it('does not let a seller order their own listing', async () => {
      const listing = await inStock();

      const response = await place(seller, listing, [['Loa', '1']]).expect(422);

      expect(response.body).toMatchObject({ code: 'OWN_LISTING' });
    });

    it('refuses a listing that is not open', async () => {
      const listing = await inStock();
      await seller.post(`/listings/${listing.id}/close`).expect(200);

      const closed = await place(buyer, listing, [['Loa', '1']]).expect(409);
      expect(closed.body).toMatchObject({ code: 'LISTING_NOT_OPEN' });

      const round = await preorder();
      await dataSource.query(
        `UPDATE listings SET order_deadline = now() - interval '1 minute' WHERE id = $1`,
        [round.id],
      );
      const expired = await place(buyer, round, [['Cam sành', '1']]).expect(
        409,
      );
      expect(expired.body).toMatchObject({ code: 'LISTING_NOT_OPEN' });
    });

    it('refuses a payment method the listing does not accept', async () => {
      const listing = await inStock({ acceptsPrepaidQr: false });

      const response = await place(buyer, listing, [['Loa', '1']], {
        paymentMethod: 'prepaid_qr',
      }).expect(422);

      expect(response.body).toMatchObject({
        code: 'PAYMENT_METHOD_NOT_ACCEPTED',
      });
    });

    it('remembers the first delivery location on the buyer profile', async () => {
      const listing = await inStock();

      await order(listing, [['Loa', '1']], { deliveryLocation: ' Tầng 9 ' });
      await order(listing, [['Loa', '1']], { deliveryLocation: 'Tầng 2' });

      const me = await buyer.get('/users/me').expect(200);
      expect(me.body).toMatchObject({ deliveryLocation: 'Tầng 9' });
    });
  });

  describe('pre-orders', () => {
    it('allow one live order per buyer and never run out', async () => {
      const round = await preorder();

      const first = await order(round, [['Cam sành', '2.5']]);
      expect(first).toMatchObject({ isPreorder: true, totalAmount: 87500 });

      const again = await place(buyer, round, [['Cam sành', '1']]).expect(409);
      expect(again.body).toMatchObject({
        code: 'ALREADY_ORDERED',
        details: { orderId: first.id },
      });

      await order(round, [['Cam sành', '9999']], {}, other);
    });

    it('can be placed again after cancelling', async () => {
      const round = await preorder();
      const first = await order(round, [['Cam sành', '1']]);

      await act(buyer, first.id, 'cancel').expect(200);

      await order(round, [['Cam sành', '2']]);
    });
  });

  describe('QR payment details', () => {
    it('are built for a QR order from the amount and the order code', async () => {
      const listing = await inStock();

      const placed = await order(listing, [['Loa', '1']], {
        paymentMethod: 'prepaid_qr',
      });

      expect(placed.qr).toMatchObject({
        amount: 500000,
        content: placed.code,
        accountNumber: '0123456789',
        accountName: 'NGUYEN VAN AN',
        bankName: 'Vietcombank',
      });
      expect(placed.qr?.payload).toContain('0006970436');
      expect(placed.qr?.payload).toContain('5406500000');
      expect(placed.qr?.payload).toContain(placed.code);
    });

    it('keep the bank account from the moment the order was placed', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']], {
        paymentMethod: 'prepaid_qr',
      });

      await seller
        .patch('/users/me')
        .send({ ...bank, bankBin: '970422', bankAccountNumber: '9999999999' })
        .expect(200);

      const reread = await buyer.get(`/orders/${placed.id}`).expect(200);
      expect((reread.body as Order).qr).toMatchObject({
        accountNumber: '0123456789',
        bankName: 'Vietcombank',
      });
    });

    it('disappear once the order is paid or cancelled', async () => {
      const listing = await inStock();
      const paid = await order(listing, [['Loa', '1']], {
        paymentMethod: 'prepaid_qr',
      });
      const cancelled = await order(listing, [['Loa', '1']], {
        paymentMethod: 'prepaid_qr',
      });

      const afterPaying = await act(seller, paid.id, 'confirm-payment').expect(
        200,
      );
      const afterCancelling = await act(buyer, cancelled.id, 'cancel').expect(
        200,
      );

      expect((afterPaying.body as Order).qr).toBeNull();
      expect((afterCancelling.body as Order).qr).toBeNull();
    });
  });

  describe('reading orders', () => {
    it('shows an order to its buyer and seller only', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']]);

      const asBuyer = await buyer.get(`/orders/${placed.id}`).expect(200);
      const asSeller = await seller.get(`/orders/${placed.id}`).expect(200);

      expect(asBuyer.body).toMatchObject({ viewerRole: 'buyer' });
      expect(asSeller.body).toMatchObject({
        viewerRole: 'seller',
        buyer: { name: 'buyer' },
      });
      await other.get(`/orders/${placed.id}`).expect(404);
      await other.post(`/orders/${placed.id}/cancel`).send({}).expect(404);
    });

    it('lists a buyer’s orders newest first', async () => {
      const listing = await inStock();
      const first = await order(listing, [['Loa', '1']]);
      const second = await order(listing, [['Cam', '1']]);

      const mine = await buyer.get('/orders').expect(200);
      const theirs = await other.get('/orders').expect(200);

      expect((mine.body as { items: Order[] }).items.map((o) => o.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(theirs.body).toEqual({ items: [], nextCursor: null });
    });

    it('lists a seller’s received orders with filters', async () => {
      const listing = await inStock();
      const round = await preorder();
      const a = await order(listing, [['Loa', '1']]);
      const b = await order(round, [['Cam sành', '1']], {}, other);
      await act(seller, a.id, 'confirm-payment').expect(200);

      const ids = async (query: string) =>
        (
          (await seller.get(`/users/me/sales${query}`).expect(200)).body as {
            items: Order[];
          }
        ).items.map((o) => o.id);

      expect(await ids('')).toEqual([b.id, a.id]);
      expect(await ids(`?listingId=${round.id}`)).toEqual([b.id]);
      expect(await ids('?paymentStatus=paid')).toEqual([a.id]);
      expect(await ids('?fulfillmentStatus=delivered')).toEqual([]);
      expect(
        (
          (await buyer.get('/users/me/sales').expect(200)).body as {
            items: Order[];
          }
        ).items,
      ).toEqual([]);
      await seller.get('/users/me/sales?paymentStatus=nope').expect(400);
    });

    it('pages through many orders without gaps or repeats', async () => {
      const round = await preorder();
      const placed: string[] = [];
      for (let i = 0; i < 25; i += 1) {
        const agent = await signIn(app, identity, `p${i}`);
        placed.push((await order(round, [['Cam sành', '1']], {}, agent)).id);
      }

      const first = (await seller.get('/users/me/sales').expect(200)).body as {
        items: Order[];
        nextCursor: string;
      };
      const second = (
        await seller
          .get(`/users/me/sales?cursor=${first.nextCursor}`)
          .expect(200)
      ).body as { items: Order[]; nextCursor: string | null };

      expect(first.items).toHaveLength(20);
      expect(second.items).toHaveLength(5);
      expect(second.nextCursor).toBeNull();
      expect([...first.items, ...second.items].map((o) => o.id)).toEqual(
        [...placed].reverse(),
      );
      await seller.get('/users/me/sales?cursor=garbage').expect(400);
    });
  });

  describe('payment and delivery', () => {
    it('follows report, confirm, deliver for a QR order', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']], {
        paymentMethod: 'prepaid_qr',
      });

      const reported = await act(buyer, placed.id, 'report-payment').expect(
        200,
      );
      expect(reported.body).toMatchObject({ paymentStatus: 'reported' });

      const confirmed = await act(seller, placed.id, 'confirm-payment').expect(
        200,
      );
      expect(confirmed.body).toMatchObject({ paymentStatus: 'paid' });

      const delivered = await act(seller, placed.id, 'deliver').expect(200);
      expect(delivered.body).toMatchObject({
        paymentStatus: 'paid',
        fulfillmentStatus: 'delivered',
      });
    });

    it('lets a pay-on-delivery order be delivered first and paid later', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']]);

      const delivered = await act(seller, placed.id, 'deliver').expect(200);
      expect(delivered.body).toMatchObject({
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'delivered',
      });

      const paid = await act(seller, placed.id, 'confirm-payment').expect(200);
      expect(paid.body).toMatchObject({ paymentStatus: 'paid' });
    });

    it('lets the seller send a reported payment back to unpaid', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']], {
        paymentMethod: 'prepaid_qr',
      });
      await act(buyer, placed.id, 'report-payment').expect(200);

      const rejected = await act(seller, placed.id, 'reject-payment').expect(
        200,
      );

      expect(rejected.body).toMatchObject({ paymentStatus: 'unpaid' });
      expect((rejected.body as Order).qr).not.toBeNull();
    });

    it('refuses steps that do not fit the current state', async () => {
      const listing = await inStock();
      const cash = await order(listing, [['Loa', '1']]);
      const qr = await order(listing, [['Loa', '1']], {
        paymentMethod: 'prepaid_qr',
      });

      const expectInvalid = async (request: ReturnType<typeof act>) => {
        const response = await request.expect(409);
        expect(response.body).toMatchObject({ code: 'INVALID_ORDER_STATE' });
      };

      await expectInvalid(act(buyer, cash.id, 'report-payment'));
      await expectInvalid(act(seller, qr.id, 'reject-payment'));
      await act(seller, qr.id, 'confirm-payment').expect(200);
      await expectInvalid(act(seller, qr.id, 'confirm-payment'));
      await expectInvalid(act(buyer, qr.id, 'report-payment'));
      await act(seller, qr.id, 'deliver').expect(200);
      await expectInvalid(act(seller, qr.id, 'deliver'));
      await expectInvalid(act(seller, qr.id, 'cancel', { reason: 'Hết hàng' }));
    });

    it('keeps each action to the right person', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']], {
        paymentMethod: 'prepaid_qr',
      });

      await act(buyer, placed.id, 'confirm-payment').expect(403);
      await act(buyer, placed.id, 'deliver').expect(403);
      await act(seller, placed.id, 'report-payment').expect(403);
      await act(other, placed.id, 'confirm-payment').expect(404);
    });

    it('delivers once when two requests arrive together', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']]);

      const responses = await Promise.all([
        act(seller, placed.id, 'deliver'),
        act(seller, placed.id, 'deliver'),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
    });
  });

  describe('cancelling', () => {
    it('lets the buyer cancel an unpaid order and returns the stock', async () => {
      const listing = await inStock();
      const placed = await order(listing, [
        ['Loa', '2'],
        ['Cam', '1.5'],
      ]);
      expect(await stockOf(listing, 'Loa')).toBe(1);

      const cancelled = await act(buyer, placed.id, 'cancel').expect(200);

      expect(cancelled.body).toMatchObject({
        fulfillmentStatus: 'cancelled',
        cancelledBy: 'buyer',
        refundNeeded: false,
      });
      expect(await stockOf(listing, 'Loa')).toBe(3);
      expect(await stockOf(listing, 'Cam')).toBe(10);
    });

    it('does not let the buyer cancel after reporting payment', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']], {
        paymentMethod: 'prepaid_qr',
      });
      await act(buyer, placed.id, 'report-payment').expect(200);

      const response = await act(buyer, placed.id, 'cancel').expect(409);

      expect(response.body).toMatchObject({ code: 'INVALID_ORDER_STATE' });
      expect(await stockOf(listing, 'Loa')).toBe(2);
    });

    it('does not let the buyer cancel a pre-order after its deadline', async () => {
      const round = await preorder();
      const placed = await order(round, [['Cam sành', '1']]);
      await dataSource.query(
        `UPDATE listings SET order_deadline = now() - interval '1 minute' WHERE id = $1`,
        [round.id],
      );

      await act(buyer, placed.id, 'cancel').expect(409);
      await act(seller, placed.id, 'cancel', {
        reason: 'Không nhập được hàng',
      }).expect(200);
    });

    it('requires a reason from the seller and flags a refund for a paid order', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']], {
        paymentMethod: 'prepaid_qr',
      });
      await act(buyer, placed.id, 'report-payment').expect(200);

      await act(seller, placed.id, 'cancel').expect(400);
      await act(seller, placed.id, 'cancel', { reason: '   ' }).expect(400);
      const cancelled = await act(seller, placed.id, 'cancel', {
        reason: 'Loa bị hỏng',
      }).expect(200);

      expect(cancelled.body).toMatchObject({
        fulfillmentStatus: 'cancelled',
        cancelledBy: 'seller',
        cancelReason: 'Loa bị hỏng',
        refundNeeded: true,
      });
      expect(await stockOf(listing, 'Loa')).toBe(3);
    });

    it('does not flag a refund when the seller cancels an unpaid order', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']]);

      const cancelled = await act(seller, placed.id, 'cancel', {
        reason: 'Đổi ý',
      }).expect(200);

      expect(cancelled.body).toMatchObject({ refundNeeded: false });
    });

    it('cannot be done twice', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']]);
      await act(buyer, placed.id, 'cancel').expect(200);

      await act(buyer, placed.id, 'cancel').expect(409);

      expect(await stockOf(listing, 'Loa')).toBe(3);
    });
  });

  describe('order count on listings', () => {
    type Counted = { orderCount: number };
    const detailCount = async (listing: Listing) =>
      ((await other.get(`/listings/${listing.id}`).expect(200)).body as Counted)
        .orderCount;
    const listCount = async (listing: Listing) =>
      (
        (await other.get('/listings').expect(200)).body as {
          items: Array<Counted & { id: string }>;
        }
      ).items.find((candidate) => candidate.id === listing.id)?.orderCount;

    it('counts live orders and follows placing and cancelling straight away', async () => {
      const round = await preorder();
      expect(await detailCount(round)).toBe(0);
      expect(await listCount(round)).toBe(0);

      const mine = await order(round, [['Cam sành', '1']]);
      await order(round, [['Cam sành', '2']], {}, other);
      expect(await detailCount(round)).toBe(2);
      expect(await listCount(round)).toBe(2);

      await act(buyer, mine.id, 'cancel').expect(200);
      expect(await detailCount(round)).toBe(1);
      expect(await listCount(round)).toBe(1);
    });
  });

  describe('editing a listing that has orders', () => {
    const edit = (listing: Listing, items: object[]) =>
      seller.patch(`/listings/${listing.id}`).send({
        mode: 'in_stock',
        condition: 'good',
        title: 'Loa và phụ kiện',
        categoryId: 4,
        acceptsPrepaidQr: true,
        acceptsPayOnDelivery: true,
        items,
      });
    const row = (listing: Listing, name: string, overrides: object = {}) => ({
      id: item(listing, name).id,
      name,
      unit: name === 'Cam' ? 'kg' : 'cái',
      unitPrice: name === 'Cam' ? 35000 : 500000,
      stockQuantity: '5',
      ...overrides,
    });

    it('keeps item ids, so a price change never touches an existing order', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']]);

      const edited = await edit(listing, [
        row(listing, 'Loa', { unitPrice: 600000 }),
        row(listing, 'Cam'),
      ]).expect(200);

      expect(item(edited.body as Listing, 'Loa').id).toBe(
        item(listing, 'Loa').id,
      );
      const reread = await buyer.get(`/orders/${placed.id}`).expect(200);
      expect(reread.body).toMatchObject({
        totalAmount: 500000,
        lines: [{ unitPrice: 500000 }],
      });
      const next = await order(listing, [['Loa', '1']]);
      expect(next.totalAmount).toBe(600000);
    });

    it('hides a removed item that was ordered, and deletes one that was not', async () => {
      const listing = await inStock();
      const placed = await order(listing, [['Loa', '1']]);

      const edited = await edit(listing, [
        {
          name: 'Tai nghe',
          unit: 'cái',
          unitPrice: 200000,
          stockQuantity: '2',
        },
      ]).expect(200);

      expect((edited.body as Listing).items.map((i) => i.name)).toEqual([
        'Tai nghe',
      ]);
      const rows: Array<{ name: string; is_active: boolean }> =
        await dataSource.query(
          'SELECT name, is_active FROM listing_items WHERE listing_id = $1 ORDER BY name',
          [listing.id],
        );
      expect(rows).toEqual([
        { name: 'Loa', is_active: false },
        { name: 'Tai nghe', is_active: true },
      ]);
      const reread = await buyer.get(`/orders/${placed.id}`).expect(200);
      expect((reread.body as Order).lines[0].itemName).toBe('Loa');

      const refused = await place(buyer, listing, [['Loa', '1']]).expect(422);
      expect(refused.body).toMatchObject({ code: 'INVALID_QUANTITY' });
    });

    it('rejects an item id that belongs to another listing', async () => {
      const listing = await inStock();
      const elsewhere = await inStock({ title: 'Bài đăng khác' });

      await edit(listing, [
        { ...row(listing, 'Loa'), id: item(elsewhere, 'Loa').id },
      ]).expect(400);
    });

    it('still finds the listing by a new item name after the edit', async () => {
      const listing = await inStock();
      await order(listing, [['Loa', '1']]);

      await edit(listing, [
        row(listing, 'Loa'),
        {
          name: 'Tai nghe Sony',
          unit: 'cái',
          unitPrice: 200000,
          stockQuantity: '2',
        },
      ]).expect(200);

      const found = await buyer.get('/listings?q=sony').expect(200);
      expect(
        (found.body as { items: Listing[] }).items.map((l) => l.id),
      ).toEqual([listing.id]);
    });
  });
});
