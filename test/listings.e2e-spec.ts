import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';

const inStock = {
  mode: 'in_stock',
  title: 'Loa bluetooth cũ',
  categoryId: 4,
  description: 'Còn mới 90%',
  acceptsPrepaidQr: false,
  acceptsPayOnDelivery: true,
  items: [
    {
      name: 'Loa JBL Go 3',
      unit: 'cái',
      unitPrice: 500000,
      stockQuantity: '1',
    },
  ],
};

const preorder = () => ({
  mode: 'preorder',
  title: 'Hoa quả tuần 41',
  categoryId: 2,
  description: 'Giao tận tầng',
  acceptsPrepaidQr: false,
  acceptsPayOnDelivery: true,
  orderDeadline: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  deliveryDate: new Date(Date.now() + 5 * 86_400_000)
    .toISOString()
    .slice(0, 10),
  items: [
    { name: 'Cam sành', unit: 'kg', unitPrice: 35000 },
    { name: 'Bưởi da xanh', unit: 'kg', unitPrice: 60000 },
  ],
});

const bank = {
  bankBin: '970436',
  bankAccountNumber: '0123456789',
  bankAccountName: 'Nguyen Van An',
};

describe('Listings API', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let seller: TestAgent;
  let buyer: TestAgent;

  const createDraft = async (body: object = inStock): Promise<string> => {
    const response = await seller.post('/listings').send(body).expect(201);
    return (response.body as { id: string }).id;
  };
  const createOpen = async (body: object = inStock): Promise<string> => {
    const id = await createDraft(body);
    await seller.post(`/listings/${id}/publish`).expect(200);
    return id;
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
    buyer = await signIn(app, identity, 'buyer');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /listings', () => {
    it('requires a session', async () => {
      const { default: request } = await import('supertest');
      await request(app.getHttpServer())
        .post('/listings')
        .send(inStock)
        .expect(401);
    });

    it('creates an in-stock draft', async () => {
      const response = await seller.post('/listings').send(inStock).expect(201);

      expect(response.body).toMatchObject({
        title: 'Loa bluetooth cũ',
        mode: 'in_stock',
        status: 'draft',
        isOpen: false,
        category: { id: 4, slug: 'dien-tu', name: 'Điện tử' },
        seller: { name: 'seller' },
        orderDeadline: null,
        deliveryDate: null,
        publishedAt: null,
        items: [
          {
            name: 'Loa JBL Go 3',
            unit: 'cái',
            unitPrice: 500000,
            stockQuantity: 1,
          },
        ],
        images: [],
      });
    });

    it('creates a pre-order draft with unlimited items in the given order', async () => {
      const body = preorder();

      const response = await seller.post('/listings').send(body).expect(201);

      expect(response.body).toMatchObject({
        mode: 'preorder',
        deliveryDate: body.deliveryDate,
        orderDeadline: body.orderDeadline,
        items: [
          { name: 'Cam sành', stockQuantity: null },
          { name: 'Bưởi da xanh', stockQuantity: null },
        ],
      });
    });

    it.each([
      [
        'an in-stock listing with a deadline',
        {
          ...inStock,
          orderDeadline: new Date().toISOString(),
          deliveryDate: '2030-01-01',
        },
        'in-stock listings do not have',
      ],
      [
        'an in-stock item without stock',
        { ...inStock, items: [{ name: 'Loa', unit: 'cái', unitPrice: 5000 }] },
        'stock is required',
      ],
      [
        'a pre-order without dates',
        { ...preorder(), orderDeadline: null, deliveryDate: null },
        'pre-order listings need an order deadline',
      ],
      [
        'no payment method',
        { ...inStock, acceptsPayOnDelivery: false },
        'at least one payment method',
      ],
      [
        'an unknown category',
        { ...inStock, categoryId: 99 },
        'Unknown category',
      ],
    ])('rejects %s with 400, never 500', async (_label, body, message) => {
      const response = await seller.post('/listings').send(body).expect(400);

      expect((response.body as { message: string }).message).toContain(message);
    });

    it('rejects a malformed body with VALIDATION_FAILED', async () => {
      const response = await seller
        .post('/listings')
        .send({
          ...inStock,
          items: [{ name: 'Loa', unit: 'cái', unitPrice: 'free' }],
        })
        .expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('requires a bank profile before accepting QR payments', async () => {
      const withQr = { ...inStock, acceptsPrepaidQr: true };

      const refused = await seller.post('/listings').send(withQr).expect(422);
      expect(refused.body).toMatchObject({ code: 'BANK_PROFILE_REQUIRED' });

      await seller.patch('/users/me').send(bank).expect(200);
      await seller.post('/listings').send(withQr).expect(201);
    });
  });

  describe('publish and close', () => {
    it('opens a draft, and refuses to publish twice', async () => {
      const id = await createDraft();

      const published = await seller
        .post(`/listings/${id}/publish`)
        .expect(200);
      expect(published.body).toMatchObject({ status: 'open', isOpen: true });
      expect((published.body as { publishedAt: string }).publishedAt).toEqual(
        expect.any(String),
      );

      const again = await seller.post(`/listings/${id}/publish`).expect(409);
      expect(again.body).toMatchObject({ code: 'INVALID_LISTING_STATE' });
    });

    it('refuses to publish a pre-order whose deadline has passed', async () => {
      const id = await createDraft(preorder());
      await dataSource.query(
        `UPDATE listings SET order_deadline = now() - interval '1 minute' WHERE id = $1`,
        [id],
      );

      await seller.post(`/listings/${id}/publish`).expect(400);
    });

    it('closes an open listing and refuses to close a draft', async () => {
      const draft = await createDraft();
      const refused = await seller.post(`/listings/${draft}/close`).expect(409);
      expect(refused.body).toMatchObject({ code: 'INVALID_LISTING_STATE' });

      const open = await createOpen();
      const closed = await seller.post(`/listings/${open}/close`).expect(200);
      expect(closed.body).toMatchObject({ status: 'closed', isOpen: false });
    });
  });

  describe('PATCH /listings/:id', () => {
    it('replaces the fields and the item list', async () => {
      const id = await createDraft();

      const response = await seller
        .patch(`/listings/${id}`)
        .send({
          ...inStock,
          title: 'Loa bluetooth giá tốt',
          items: [
            {
              name: 'Loa Sony',
              unit: 'cái',
              unitPrice: 700000,
              stockQuantity: '2',
            },
            {
              name: 'Dây sạc',
              unit: 'cái',
              unitPrice: 20000,
              stockQuantity: '5',
            },
          ],
        })
        .expect(200);

      expect(response.body).toMatchObject({
        title: 'Loa bluetooth giá tốt',
        items: [{ name: 'Loa Sony' }, { name: 'Dây sạc' }],
      });
      const rows: Array<{ count: string }> = await dataSource.query(
        'SELECT COUNT(*) AS count FROM listing_items WHERE listing_id = $1',
        [id],
      );
      expect(Number(rows[0].count)).toBe(2);
    });

    it('refuses to change the mode or to edit a closed listing', async () => {
      const id = await createOpen();

      await seller.patch(`/listings/${id}`).send(preorder()).expect(400);

      await seller.post(`/listings/${id}/close`).expect(200);
      const response = await seller
        .patch(`/listings/${id}`)
        .send(inStock)
        .expect(409);
      expect(response.body).toMatchObject({ code: 'INVALID_LISTING_STATE' });
    });
  });

  describe('visibility and ownership', () => {
    it('hides a draft from other people and shows it once open', async () => {
      const id = await createDraft();

      await buyer.get(`/listings/${id}`).expect(404);
      await seller.get(`/listings/${id}`).expect(200);

      await seller.post(`/listings/${id}/publish`).expect(200);
      const response = await buyer.get(`/listings/${id}`).expect(200);
      expect(response.body).toMatchObject({ id, isOpen: true });
    });

    it('hides a closed listing from other people but not from the seller', async () => {
      const id = await createOpen();
      await seller.post(`/listings/${id}/close`).expect(200);

      await buyer.get(`/listings/${id}`).expect(404);
      await seller.get(`/listings/${id}`).expect(200);
    });

    it('hides an open pre-order once its deadline has passed', async () => {
      const id = await createOpen(preorder());
      await buyer.get(`/listings/${id}`).expect(200);

      await dataSource.query(
        `UPDATE listings SET order_deadline = now() - interval '1 minute' WHERE id = $1`,
        [id],
      );

      await buyer.get(`/listings/${id}`).expect(404);
      const own = await seller.get(`/listings/${id}`).expect(200);
      expect(own.body).toMatchObject({ status: 'open', isOpen: false });
    });

    it('lets only the seller edit, publish and close', async () => {
      const draft = await createDraft();
      const open = await createOpen();

      await buyer.patch(`/listings/${draft}`).send(inStock).expect(403);
      await buyer.post(`/listings/${draft}/publish`).expect(403);
      await buyer.post(`/listings/${open}/close`).expect(403);
    });

    it('returns 404 for an unknown id and 400 for a malformed one', async () => {
      await seller
        .get('/listings/00000000-0000-4000-8000-000000000000')
        .expect(404);
      await seller.get('/listings/not-a-uuid').expect(400);
    });
  });

  describe('GET /users/me/listings', () => {
    it('returns only the caller’s listings, newest first, filtered by status', async () => {
      const draft = await createDraft();
      const open = await createOpen({ ...inStock, title: 'Bàn phím cơ cũ' });

      const all = await seller.get('/users/me/listings').expect(200);
      expect((all.body as Array<{ id: string }>).map((l) => l.id)).toEqual([
        open,
        draft,
      ]);

      const drafts = await seller
        .get('/users/me/listings?status=draft')
        .expect(200);
      expect((drafts.body as Array<{ id: string }>).map((l) => l.id)).toEqual([
        draft,
      ]);

      const none = await buyer.get('/users/me/listings').expect(200);
      expect(none.body).toEqual([]);

      await seller.get('/users/me/listings?status=nonsense').expect(400);
    });
  });
});
