import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';
import { campaignBody, itemBody, type TestCampaign } from './utils/market.js';

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

/** A round of one product (35,000 đ per kg) that closes in so many hours. */
const round = (
  title: string,
  hoursUntilDeadline: number,
  items: object[] = [itemBody({ title, unit: 'kg', unitPrice: 35000 })],
) =>
  campaignBody({
    title: `Đợt ${title}`,
    orderDeadline: new Date(
      Date.now() + hoursUntilDeadline * 3_600_000,
    ).toISOString(),
    deliveryDate: new Date(Date.now() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10),
    items,
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

  /** Publishes a round; returns its id. */
  const openRound = async (body: object): Promise<string> => {
    const response = await seller.post('/campaigns').send(body).expect(201);
    const id = (response.body as TestCampaign).id;
    await seller.post(`/campaigns/${id}/publish`).expect(200);
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
    const stockOf = async (
      title: string,
      query = '',
    ): Promise<number | null> => {
      const page = await buyer.get(`/listings${query}`).expect(200);
      return page.body.items.find((l: { title: string }) => l.title === title)
        .stockQuantity;
    };

    it('is the remaining stock of an in-stock product', async () => {
      await createOpen(inStock('Sua chua tuoi', '24'));
      expect(await stockOf('Sua chua tuoi')).toBe(24);
    });

    it('is null for a pre-order', async () => {
      await openRound(round('Hoa qua tuoi tro', 48));
      expect(await stockOf('Hoa qua tuoi tro', '?mode=preorder')).toBeNull();
    });
  });

  describe('GET /listings?mode=in_stock', () => {
    it('is the default and leaves out products that are sold out', async () => {
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

      await openRound(round('Đặt trước', 48));

      expect(await titles('?mode=in_stock')).toEqual(['Còn hàng']);
      expect(await titles('')).toEqual(['Còn hàng']);
    });
  });

  describe('GET /listings?mode=preorder', () => {
    const titles = (body: { items: { title: string }[] }) =>
      body.items.map((l) => l.title);

    it('returns products of open rounds closing soonest first and nothing else', async () => {
      await openRound(round('Thứ Sáu', 72));
      await createOpen(inStock('Có sẵn'));
      await openRound(round('Hôm nay', 2));
      await openRound(round('Ngày mai', 26));
      // A draft round is not listed.
      await seller.post('/campaigns').send(round('Bản nháp', 1)).expect(201);

      const page = await buyer.get('/listings?mode=preorder').expect(200);

      expect(titles(page.body)).toEqual(['Hôm nay', 'Ngày mai', 'Thứ Sáu']);
      expect(page.body.items[0]).toMatchObject({
        mode: 'preorder',
        stockQuantity: null,
        campaign: { title: 'Đợt Hôm nay' },
      });
    });

    it('keeps the products of a round together, in the order of the round', async () => {
      await openRound(
        round('Sau', 5, [
          itemBody({ title: 'Sau 1' }),
          itemBody({ title: 'Sau 2' }),
        ]),
      );
      await openRound(
        round('Trước', 2, [
          itemBody({ title: 'Trước 1' }),
          itemBody({ title: 'Trước 2' }),
          itemBody({ title: 'Trước 3' }),
        ]),
      );

      const page = await buyer.get('/listings?mode=preorder').expect(200);

      expect(titles(page.body)).toEqual([
        'Trước 1',
        'Trước 2',
        'Trước 3',
        'Sau 1',
        'Sau 2',
      ]);
    });

    it('leaves out a round whose deadline has passed', async () => {
      const id = await openRound(round('Đã chốt', 2));
      await openRound(round('Còn mở', 5));
      await dataSource.query(
        `UPDATE campaigns SET order_deadline = now() - interval '1 minute' WHERE id = $1`,
        [id],
      );
      await redis.flushdb();

      const page = await buyer.get('/listings?mode=preorder').expect(200);

      expect(titles(page.body)).toEqual(['Còn mở']);
    });

    it('pages by cursor without repeating or skipping, also inside a round', async () => {
      // Two rounds share a deadline, so the round and the position decide.
      const sameDeadline = new Date(Date.now() + 3_600_000).toISOString();
      for (const name of ['A', 'B']) {
        await openRound({
          ...round(name, 1, [
            itemBody({ title: `${name} 1` }),
            itemBody({ title: `${name} 2` }),
            itemBody({ title: `${name} 3` }),
          ]),
          orderDeadline: sameDeadline,
        });
      }
      await openRound(round('Sau cùng', 4));

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const url: string = `/listings?mode=preorder&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
        const body = (await buyer.get(url).expect(200)).body as {
          items: { title: string }[];
          nextCursor: string | null;
        };
        seen.push(...titles(body));
        cursor = body.nextCursor;
        pages += 1;
      } while (cursor);

      expect(pages).toBe(4);
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
      expect(seen[6]).toBe('Sau cùng');
      // Each round's products come one after the other, in their order.
      const firstRound = seen[0].slice(0, 1);
      const secondRound = firstRound === 'A' ? 'B' : 'A';
      expect(seen.slice(0, 6)).toEqual([
        `${firstRound} 1`,
        `${firstRound} 2`,
        `${firstRound} 3`,
        `${secondRound} 1`,
        `${secondRound} 2`,
        `${secondRound} 3`,
      ]);
    });

    it('searches the products of open rounds by keyword', async () => {
      await openRound(
        round('Trái cây', 5, [
          itemBody({ title: 'Cam sành' }),
          itemBody({ title: 'Bưởi da xanh' }),
        ]),
      );
      await createOpen(inStock('Cam sành hộp'));

      const page = await buyer.get('/listings?mode=preorder&q=cam').expect(200);

      expect(titles(page.body)).toEqual(['Cam sành']);
    });

    it('rejects a cursor of another ordering and the retired sort', async () => {
      await buyer.get('/listings?sort=deadline').expect(400);

      await createOpen(inStock('Bánh A'));
      await createOpen(inStock('Bánh B'));
      const recent = await buyer.get('/listings?limit=1').expect(200);
      await buyer
        .get(`/listings?mode=preorder&cursor=${recent.body.nextCursor}`)
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
      await openRound(round('Hoa quả', 48));
    });

    it('keeps products whose price is inside the range', async () => {
      expect(await titles('minPrice=100000&maxPrice=1000000')).toEqual([
        'Bàn phím',
      ]);
      expect(await titles('maxPrice=60000')).toEqual(['Chuột rẻ']);
      expect(await titles('mode=preorder&maxPrice=40000')).toEqual(['Hoa quả']);
      expect(await titles('mode=preorder&minPrice=40000')).toEqual([]);
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
