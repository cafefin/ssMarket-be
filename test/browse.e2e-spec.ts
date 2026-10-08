import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';

const inStock = (title: string, stockQuantity = '5') => ({
  mode: 'in_stock',
  title,
  categoryId: 3,
  description: 'Nhà làm',
  acceptsPrepaidQr: false,
  acceptsPayOnDelivery: true,
  unit: 'hộp',
  unitPrice: 15000,
  stockQuantity,
});

const preorder = (title: string, hoursUntilDeadline: number) => ({
  mode: 'preorder',
  title,
  categoryId: 2,
  description: 'Giao tận tầng',
  acceptsPrepaidQr: false,
  acceptsPayOnDelivery: true,
  orderDeadline: new Date(
    Date.now() + hoursUntilDeadline * 3_600_000,
  ).toISOString(),
  deliveryDate: new Date(Date.now() + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10),
  unit: 'kg',
  unitPrice: 35000,
});

describe('Browse listings', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let seller: TestAgent;
  let buyer: TestAgent;

  const createOpen = async (body: object): Promise<string> => {
    const response = await seller.post('/listings').send(body).expect(201);
    const id = (response.body as { id: string }).id;
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

  describe('stockQuantity on a summary', () => {
    const stockOf = async (title: string): Promise<number | null> => {
      const page = await buyer.get('/listings').expect(200);
      return page.body.items.find((l: { title: string }) => l.title === title)
        .stockQuantity;
    };

    it('is the remaining stock of an in-stock product', async () => {
      await createOpen(inStock('Sua chua tuoi', '24'));
      expect(await stockOf('Sua chua tuoi')).toBe(24);
    });

    it('is null for a pre-order', async () => {
      await createOpen(preorder('Hoa qua tuoi tro', 48));
      expect(await stockOf('Hoa qua tuoi tro')).toBeNull();
    });
  });

  describe('GET /listings?mode=in_stock', () => {
    it('leaves out products that are sold out, which "all" still shows', async () => {
      await createOpen(inStock('Còn hàng'));
      const soldOut = await createOpen(inStock('Hết hàng', '1'));
      await dataSource.query(
        'UPDATE listings SET stock_quantity = 0 WHERE id = $1',
        [soldOut],
      );
      await redis.flushdb();

      const titles = async (query: string) =>
        (await buyer.get(`/listings${query}`).expect(200)).body.items
          .map((l: { title: string }) => l.title)
          .sort();

      expect(await titles('?mode=in_stock')).toEqual(['Còn hàng']);
      expect(await titles('')).toEqual(['Còn hàng', 'Hết hàng']);
    });
  });

  describe('GET /listings?sort=deadline', () => {
    const titles = (body: { items: { title: string }[] }) =>
      body.items.map((l) => l.title);

    it('returns pre-orders closing soonest first and nothing else', async () => {
      await createOpen(preorder('Thứ Sáu', 72));
      await createOpen(inStock('Có sẵn'));
      await createOpen(preorder('Hôm nay', 2));
      await createOpen(preorder('Ngày mai', 26));

      const page = await buyer.get('/listings?sort=deadline').expect(200);

      expect(titles(page.body)).toEqual(['Hôm nay', 'Ngày mai', 'Thứ Sáu']);
    });

    it('leaves out a round whose deadline has passed', async () => {
      const id = await createOpen(preorder('Đã chốt', 2));
      await createOpen(preorder('Còn mở', 5));
      await dataSource.query(
        `UPDATE listings SET order_deadline = now() - interval '1 minute' WHERE id = $1`,
        [id],
      );
      await redis.flushdb();

      const page = await buyer.get('/listings?sort=deadline').expect(200);

      expect(titles(page.body)).toEqual(['Còn mở']);
    });

    it('pages by cursor without repeating or skipping', async () => {
      for (const hours of [5, 1, 4, 2, 3]) {
        await createOpen(preorder(`Sau ${hours} giờ`, hours));
      }

      const first = await buyer
        .get('/listings?sort=deadline&limit=2')
        .expect(200);
      const second = await buyer
        .get(`/listings?sort=deadline&limit=2&cursor=${first.body.nextCursor}`)
        .expect(200);
      const third = await buyer
        .get(`/listings?sort=deadline&limit=2&cursor=${second.body.nextCursor}`)
        .expect(200);

      expect([
        ...titles(first.body),
        ...titles(second.body),
        ...titles(third.body),
      ]).toEqual([1, 2, 3, 4, 5].map((hours) => `Sau ${hours} giờ`));
      expect(third.body.nextCursor).toBeNull();
    });

    it('rejects combinations that make no sense', async () => {
      await buyer.get('/listings?sort=deadline&q=cam').expect(400);
      await buyer.get('/listings?sort=deadline&mode=in_stock').expect(400);
      await buyer.get('/listings?sort=soonest').expect(400);

      await createOpen(inStock('Bánh A'));
      await createOpen(inStock('Bánh B'));
      const recent = await buyer.get('/listings?limit=1').expect(200);
      await buyer
        .get(`/listings?sort=deadline&cursor=${recent.body.nextCursor}`)
        .expect(400);
    });
  });

  describe('GET /listings?seller=', () => {
    it("returns only that seller's open listings", async () => {
      await createOpen(inStock('Của người bán'));
      await seller.post('/listings').send(inStock('Bản nháp')).expect(201);
      const other = await buyer
        .post('/listings')
        .send(inStock('Của người khác'))
        .expect(201);
      await buyer.post(`/listings/${other.body.id}/publish`).expect(200);
      const sellerId = (await seller.get('/users/me').expect(200)).body.id;

      const page = await buyer.get(`/listings?seller=${sellerId}`).expect(200);

      expect(page.body.items.map((l: { title: string }) => l.title)).toEqual([
        'Của người bán',
      ]);
    });

    it('rejects a seller that is not a UUID', async () => {
      await buyer.get('/listings?seller=abc').expect(400);
    });
  });

  describe('price and condition filters', () => {
    const gadget = (title: string, unitPrice: number, condition: string) => ({
      mode: 'in_stock',
      condition,
      title,
      categoryId: 4,
      description: '',
      acceptsPrepaidQr: false,
      acceptsPayOnDelivery: true,
      unit: 'cái',
      unitPrice,
      stockQuantity: '1',
    });
    const titles = async (query: string): Promise<string[]> => {
      const page = await buyer.get(`/listings?${query}`).expect(200);
      return page.body.items.map((l: { title: string }) => l.title).sort();
    };

    beforeEach(async () => {
      await createOpen(gadget('Chuột rẻ', 50000, 'fair'));
      await createOpen(gadget('Bàn phím', 300000, 'like_new'));
      await createOpen(gadget('Màn hình', 2000000, 'good'));
      await createOpen(preorder('Hoa quả', 48));
    });

    it('keeps products whose price is inside the range', async () => {
      expect(await titles('minPrice=100000&maxPrice=1000000')).toEqual([
        'Bàn phím',
      ]);
      expect(await titles('maxPrice=40000')).toEqual(['Hoa quả']);
    });

    it('keeps second-hand goods at least as good as asked', async () => {
      expect(await titles('minCondition=good')).toEqual([
        'Bàn phím',
        'Màn hình',
      ]);
      expect(await titles('minCondition=worn')).toEqual([
        'Bàn phím',
        'Chuột rẻ',
        'Màn hình',
      ]);
    });

    it('rejects a range that ends before it starts and unknown levels', async () => {
      await buyer.get('/listings?minPrice=10&maxPrice=5').expect(400);
      await buyer.get('/listings?minCondition=shiny').expect(400);
      await buyer.get('/listings?minPrice=-1').expect(400);
    });
  });
});
