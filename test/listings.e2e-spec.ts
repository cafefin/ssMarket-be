import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';

const inStock = {
  mode: 'in_stock',
  condition: 'good',
  title: 'Loa bluetooth cũ',
  categoryId: 4,
  description: 'Còn mới 90%',
  acceptsPrepaidQr: false,
  acceptsPayOnDelivery: true,
  unit: 'cái',
  unitPrice: 500000,
  stockQuantity: '1',
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
  unit: 'kg',
  unitPrice: 35000,
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
    it('stores the condition of second-hand goods and shows it everywhere', async () => {
      const id = await createOpen();

      const detail = await seller.get(`/listings/${id}`).expect(200);
      expect(detail.body).toMatchObject({
        condition: 'good',
        conditionPercent: 90,
      });
      const page = await seller.get('/listings').expect(200);
      expect(page.body.items[0]).toMatchObject({
        condition: 'good',
        conditionPercent: 90,
        unitPrice: 500000,
        unit: 'cái',
        stockQuantity: 1,
        hasCombos: false,
        seller: { name: 'seller', handle: 'seller' },
        category: { id: 4, isPerishable: false },
      });
    });

    it('asks for a condition outside food and refuses one on food', async () => {
      const { condition: _omitted, ...withoutCondition } = inStock;
      const missing = await seller
        .post('/listings')
        .send(withoutCondition)
        .expect(400);
      expect(missing.body.message).toContain('in-stock goods need a condition');

      const food = await seller
        .post('/listings')
        .send({ ...inStock, categoryId: 2 })
        .expect(400);
      expect(food.body.message).toContain(
        'only in-stock goods outside food categories have a condition',
      );
      await seller
        .post('/listings')
        .send({ ...withoutCondition, categoryId: 2 })
        .expect(201);
    });

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
        unit: 'cái',
        unitPrice: 500000,
        stockQuantity: 1,
        combos: [],
        images: [],
      });
    });

    it('creates a pre-order draft without stock', async () => {
      const body = preorder();

      const response = await seller.post('/listings').send(body).expect(201);

      expect(response.body).toMatchObject({
        mode: 'preorder',
        deliveryDate: body.deliveryDate,
        orderDeadline: body.orderDeadline,
        unit: 'kg',
        unitPrice: 35000,
        stockQuantity: null,
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
        'an in-stock product without stock',
        { ...inStock, stockQuantity: null },
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
          unitPrice: 'free',
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
    it('replaces the fields, price, stock and combos', async () => {
      const id = await createDraft({
        ...inStock,
        combos: [{ quantity: '2', price: 900000 }],
      });

      const response = await seller
        .patch(`/listings/${id}`)
        .send({
          ...inStock,
          title: 'Loa bluetooth giá tốt',
          unitPrice: 700000,
          stockQuantity: '2',
          combos: [{ quantity: '2', price: 1300000 }],
        })
        .expect(200);

      expect(response.body).toMatchObject({
        title: 'Loa bluetooth giá tốt',
        unitPrice: 700000,
        stockQuantity: 2,
        combos: [{ quantity: '2', price: 1300000 }],
      });
      const rows: Array<{ count: string }> = await dataSource.query(
        'SELECT COUNT(*) AS count FROM listing_combos WHERE listing_id = $1',
        [id],
      );
      expect(Number(rows[0].count)).toBe(1);
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
      // The deadline was moved behind the API's back, so drop the cached copy
      // that still carries the old one.
      await redis.flushdb();

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

  describe('GET /listings', () => {
    type Page = {
      items: Array<{ id: string; title: string }>;
      nextCursor: string | null;
    };
    const titles = (body: unknown) => (body as Page).items.map((l) => l.title);
    const search = async (query: string) =>
      (await buyer.get(`/listings?${query}`).expect(200)).body as Page;

    it('returns open listings newest first with summary fields', async () => {
      await createOpen();
      const fruit = await createOpen(preorder());

      const response = await buyer.get('/listings').expect(200);

      expect(titles(response.body)).toEqual([
        'Hoa quả tuần 41',
        'Loa bluetooth cũ',
      ]);
      expect((response.body as Page).items[0]).toMatchObject({
        id: fruit,
        mode: 'preorder',
        category: { slug: 'thuc-pham-tuoi' },
        seller: { name: 'seller' },
        thumbnailUrl: null,
        unitPrice: 35000,
        unit: 'kg',
        stockQuantity: null,
      });
      expect((response.body as Page).nextCursor).toBeNull();
    });

    it('finds Vietnamese text typed with or without diacritics', async () => {
      await createOpen(preorder());
      await createOpen();

      expect(titles(await search('q=hoa%20qua'))).toEqual(['Hoa quả tuần 41']);
      expect(
        titles(await search(`q=${encodeURIComponent('HOA QUẢ')}`)),
      ).toEqual(['Hoa quả tuần 41']);
    });

    it('finds a listing by its description and by a prefix', async () => {
      await createOpen({
        ...inStock,
        title: 'Thanh lý đồ cũ',
        description: 'Loa JBL Go 3',
      });
      await createOpen(preorder());

      expect(titles(await search('q=jbl'))).toEqual(['Thanh lý đồ cũ']);
      expect(titles(await search('q=lo'))).toEqual(['Thanh lý đồ cũ']);
      expect(titles(await search('q=loa%20xyz'))).toEqual([]);
    });

    it('treats search operators and SQL in the query as plain text', async () => {
      await createOpen();

      const response = await buyer
        .get(`/listings?q=${encodeURIComponent("loa' OR 1=1 -- & | !")}`)
        .expect(200);

      expect(titles(response.body)).toEqual([]);
      expect(titles(await search(`q=${encodeURIComponent('!!! &')}`))).toEqual([
        'Loa bluetooth cũ',
      ]);
    });

    it('filters by category and mode', async () => {
      await createOpen();
      await createOpen(preorder());

      expect(titles(await search('category=dien-tu'))).toEqual([
        'Loa bluetooth cũ',
      ]);
      expect(titles(await search('mode=preorder'))).toEqual([
        'Hoa quả tuần 41',
      ]);
      expect(titles(await search('category=dien-tu&mode=preorder'))).toEqual(
        [],
      );
      expect(titles(await search('category=khong-co'))).toEqual([]);
      await buyer.get('/listings?mode=nonsense').expect(400);
    });

    it('never lists drafts, closed listings or expired pre-orders', async () => {
      await createDraft();
      const closed = await createOpen({ ...inStock, title: 'Đã đóng rồi' });
      await seller.post(`/listings/${closed}/close`).expect(200);
      const expired = await createOpen(preorder());
      await dataSource.query(
        `UPDATE listings SET order_deadline = now() - interval '1 minute' WHERE id = $1`,
        [expired],
      );
      await redis.flushdb();

      expect(titles(await search(''))).toEqual([]);
      expect(titles(await search('q=hoa'))).toEqual([]);
    });

    it('pages through every listing exactly once, newest first', async () => {
      const created: string[] = [];
      for (let i = 0; i < 30; i += 1) {
        created.push(
          await createOpen({ ...inStock, title: `Loa số ${i + 1}` }),
        );
      }

      for (const query of ['', 'q=loa&']) {
        const seen: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const page: Page = await search(
            `${query}limit=12${cursor ? `&cursor=${cursor}` : ''}`,
          );
          seen.push(...page.items.map((l) => l.id));
          cursor = page.nextCursor;
          pages += 1;
        } while (cursor !== null);

        expect(pages).toBe(3);
        expect(new Set(seen).size).toBe(30);
        expect([...seen].sort()).toEqual([...created].sort());
        if (query === '') {
          expect(seen).toEqual([...created].reverse());
        }
      }
    });

    it('clamps the limit and rejects a malformed or mismatched cursor', async () => {
      for (let i = 0; i < 3; i += 1) {
        await createOpen({ ...inStock, title: `Loa số ${i + 1}` });
      }

      expect((await search('limit=0')).items).toHaveLength(1);
      expect((await search('limit=999')).items).toHaveLength(3);
      await buyer.get('/listings?cursor=garbage').expect(400);

      const first = await search('limit=1');
      await buyer.get(`/listings?q=loa&cursor=${first.nextCursor}`).expect(400);
    });

    it('shows an edit immediately in the list and the detail', async () => {
      const id = await createOpen();
      await search('');
      await buyer.get(`/listings/${id}`).expect(200);

      await seller
        .patch(`/listings/${id}`)
        .send({ ...inStock, title: 'Loa bluetooth giá mới' })
        .expect(200);

      expect(titles(await search(''))).toEqual(['Loa bluetooth giá mới']);
      const detail = await buyer.get(`/listings/${id}`).expect(200);
      expect(detail.body).toMatchObject({ title: 'Loa bluetooth giá mới' });
    });

    it('serves repeated requests from the cache', async () => {
      const id = await createOpen();
      await search('');
      await buyer.get(`/listings/${id}`).expect(200);

      const keys = await redis.keys('listings:v*');

      expect(keys.some((key) => key.includes(':list:'))).toBe(true);
      expect(keys.some((key) => key.endsWith(`:detail:${id}`))).toBe(true);
    });

    it('does not cache a draft', async () => {
      const id = await createDraft();
      await seller.get(`/listings/${id}`).expect(200);
      await buyer.get(`/listings/${id}`).expect(404);

      expect(await redis.keys('listings:v*:detail:*')).toEqual([]);
    });

    it('keeps working when Redis reads fail', async () => {
      await createOpen();
      const get = vi
        .spyOn(redis, 'get')
        .mockRejectedValue(new Error('redis down'));

      try {
        expect(titles(await search(''))).toEqual(['Loa bluetooth cũ']);
      } finally {
        get.mockRestore();
      }
    });
  });
});
