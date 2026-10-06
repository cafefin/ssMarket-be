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
  orderDeadline: new Date(Date.now() + hoursUntilDeadline * 3_600_000).toISOString(),
  deliveryDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
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
      await createOpen(inStock('Banh ga hoac banh mi', [item('Nho', '5'), item('Lon', '3')]));
      expect(await stockOf('Banh ga hoac banh mi')).toBeNull();
    });

    it('is null for a pre-order', async () => {
      await createOpen(preorder('Hoa qua tuoi tro', 48));
      expect(await stockOf('Hoa qua tuoi tro')).toBeNull();
    });
  });
});
