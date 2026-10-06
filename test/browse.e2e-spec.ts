import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';

const item = (name: string, stockQuantity?: string) => ({
  name,
  unit: 'hộp',
  unitPrice: 15000,
  ...(stockQuantity === undefined ? {} : { stockQuantity }),
});

const inStock = (title: string, items: object[]) => ({
  mode: 'in_stock',
  title,
  categoryId: 3,
  description: 'Nhà làm',
  acceptsPrepaidQr: false,
  acceptsPayOnDelivery: true,
  items,
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
  items: [{ name: 'Cam sành', unit: 'kg', unitPrice: 35000 }],
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

    it('is the remaining stock of a single limited item', async () => {
      await createOpen(inStock('Sua chua tuoi', [item('Hu', '24')]));
      expect(await stockOf('Sua chua tuoi')).toBe(24);
    });

    it('is null when the listing has more than one item', async () => {
      await createOpen(
        inStock('Banh ga hoac banh mi', [item('Nho', '5'), item('Lon', '3')]),
      );
      expect(await stockOf('Banh ga hoac banh mi')).toBeNull();
    });

    it('is null for a pre-order', async () => {
      await createOpen(preorder('Hoa qua tuoi tro', 48));
      expect(await stockOf('Hoa qua tuoi tro')).toBeNull();
    });
  });

  describe('GET /listings?sort=deadline', () => {
    const titles = (body: { items: { title: string }[] }) =>
      body.items.map((l) => l.title);

    it('returns pre-orders closing soonest first and nothing else', async () => {
      await createOpen(preorder('Thứ Sáu', 72));
      await createOpen(inStock('Có sẵn', [item('Hũ', '5')]));
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

      await createOpen(inStock('Bánh A', [item('Hũ', '5')]));
      await createOpen(inStock('Bánh B', [item('Hũ', '5')]));
      const recent = await buyer.get('/listings?limit=1').expect(200);
      await buyer
        .get(`/listings?sort=deadline&cursor=${recent.body.nextCursor}`)
        .expect(400);
    });
  });

  describe('GET /listings?seller=', () => {
    it("returns only that seller's open listings", async () => {
      await createOpen(inStock('Của người bán', [item('Hũ', '5')]));
      await seller
        .post('/listings')
        .send(inStock('Bản nháp', [item('Hũ', '5')]))
        .expect(201);
      const other = await buyer
        .post('/listings')
        .send(inStock('Của người khác', [item('Hũ', '5')]))
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
});
