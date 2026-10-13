import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import sharp from 'sharp';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';
import {
  campaignBody,
  checkout,
  inStockBody,
  itemBody,
  itemOf,
  publishCampaign,
  type TestCampaign,
} from './utils/market.js';

type ListedItem = {
  id: string;
  title: string;
  campaign: { id: string; title: string; orderDeadline: string } | null;
};

describe('Campaigns API', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let seller: TestAgent;
  let buyer: TestAgent;

  const createDraft = async (
    body: object = campaignBody(),
  ): Promise<TestCampaign> => {
    const response = await seller.post('/campaigns').send(body).expect(201);
    return response.body as TestCampaign;
  };
  /** The products `GET /listings?mode=preorder` shows to the buyer. */
  const preorderItems = async (): Promise<ListedItem[]> => {
    const page = await buyer.get('/listings?mode=preorder').expect(200);
    return (page.body as { items: ListedItem[] }).items;
  };
  const expireDeadline = (id: string) =>
    dataSource.query(
      `UPDATE campaigns SET order_deadline = now() - interval '1 minute' WHERE id = $1`,
      [id],
    );
  /** The body that keeps a campaign's items as they are. */
  const sameItems = (campaign: TestCampaign) =>
    campaign.items.map((item) => ({
      id: item.id,
      title: item.title,
      unit: item.unit,
      unitPrice: item.unitPrice,
    }));

  beforeAll(async () => {
    app = await createTestApp(identity);
    dataSource = app.get(DataSource);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('UPDATE categories SET is_active = true');
    await redis.flushdb();
    seller = await signIn(app, identity, 'seller');
    buyer = await signIn(app, identity, 'buyer');
  });

  afterAll(async () => {
    await dataSource.query('UPDATE categories SET is_active = true');
    await app.close();
  });

  it('requires a session', async () => {
    const { default: request } = await import('supertest');
    await request(app.getHttpServer())
      .post('/campaigns')
      .send(campaignBody())
      .expect(401);
  });

  it('creates a draft that only its seller sees', async () => {
    const response = await seller
      .post('/campaigns')
      .send(campaignBody())
      .expect(201);

    expect(response.body).toMatchObject({
      title: 'Bánh bao tuần này',
      status: 'draft',
      isOpen: false,
      acceptsPrepaidQr: false,
      acceptsPayOnDelivery: true,
      category: { id: 2 },
      seller: { handle: 'seller' },
      itemCount: 2,
      minPrice: 15000,
      publishedAt: null,
      reopenedFromId: null,
      items: [
        {
          title: 'Bánh bao chay',
          unit: 'cái',
          unitPrice: 15000,
          selling: true,
          removable: true,
          orderCount: 0,
        },
        {
          title: 'Bánh bao nhân thịt',
          unitPrice: 18000,
          selling: true,
          removable: true,
        },
      ],
    });
    const id = (response.body as TestCampaign).id;

    await buyer.get(`/campaigns/${id}`).expect(404);
    const own = await seller.get(`/campaigns/${id}`).expect(200);
    expect((own.body as TestCampaign).items).toHaveLength(2);
  });

  it('answers 422 INVALID_CAMPAIGN with the problems of the input', async () => {
    const response = await seller
      .post('/campaigns')
      .send(campaignBody({ items: [itemBody({ title: 'X' })] }))
      .expect(422);

    expect(response.body.code).toBe('INVALID_CAMPAIGN');
    expect(response.body.details.problems).toContain(
      'item 1: title must be 2-120 characters',
    );
  });

  it('refuses an unknown or hidden category and QR without a bank profile', async () => {
    await seller
      .post('/campaigns')
      .send(campaignBody({ categoryId: 9999 }))
      .expect(400);

    await dataSource.query(
      'UPDATE categories SET is_active = false WHERE id = 2',
    );
    const hidden = await seller
      .post('/campaigns')
      .send(campaignBody())
      .expect(400);
    expect(hidden.body.code).toBe('CATEGORY_INACTIVE');
    await dataSource.query('UPDATE categories SET is_active = true');

    const qr = await seller
      .post('/campaigns')
      .send(campaignBody({ acceptsPrepaidQr: true }))
      .expect(422);
    expect(qr.body.code).toBe('BANK_PROFILE_REQUIRED');
  });

  it('publishes a draft once, with a deadline ahead, and lists its products as pre-orders', async () => {
    const late = await createDraft();
    await expireDeadline(late.id);
    await seller.post(`/campaigns/${late.id}/publish`).expect(400);

    const draft = await createDraft();
    const published = await seller
      .post(`/campaigns/${draft.id}/publish`)
      .expect(200);
    expect(published.body).toMatchObject({ status: 'open', isOpen: true });
    expect(published.body.publishedAt).toEqual(expect.any(String));

    const again = await seller
      .post(`/campaigns/${draft.id}/publish`)
      .expect(409);
    expect(again.body.code).toBe('INVALID_LISTING_STATE');

    const items = await preorderItems();
    expect(items.map((item) => item.title)).toEqual([
      'Bánh bao chay',
      'Bánh bao nhân thịt',
    ]);
    for (const item of items) {
      expect(item.campaign).toMatchObject({
        id: draft.id,
        title: 'Bánh bao tuần này',
        orderDeadline: draft.orderDeadline,
        deliveryDate: draft.deliveryDate,
      });
    }

    const inStock = await buyer.get('/listings').expect(200);
    expect(inStock.body.items).toEqual([]);
  });

  it('edits an open round: renames, adds and drops products', async () => {
    const campaign = await publishCampaign(seller);

    const patched = await seller
      .patch(`/campaigns/${campaign.id}`)
      .send(
        campaignBody({
          title: 'Bánh bao tuần sau',
          items: [
            itemBody({ id: campaign.items[0].id, title: 'Bánh bao chay lớn' }),
            itemBody({ title: 'Xôi', unitPrice: 12000 }),
          ],
        }),
      )
      .expect(200);

    const body = patched.body as TestCampaign;
    expect(body.title).toBe('Bánh bao tuần sau');
    expect(body.items.map((item) => item.title)).toEqual([
      'Bánh bao chay lớn',
      'Xôi',
    ]);
    expect(body.items[0].id).toBe(campaign.items[0].id);

    const listed = await preorderItems();
    expect(listed.map((item) => item.title)).toEqual([
      'Bánh bao chay lớn',
      'Xôi',
    ]);
    expect(listed[1].campaign?.title).toBe('Bánh bao tuần sau');
  });

  it('refuses a product id that belongs to another round', async () => {
    const campaign = await publishCampaign(seller);
    const other = await publishCampaign(seller);

    const response = await seller
      .patch(`/campaigns/${campaign.id}`)
      .send(
        campaignBody({
          items: [itemBody({ id: other.items[0].id })],
        }),
      )
      .expect(422);

    expect(response.body.code).toBe('INVALID_CAMPAIGN');
    expect(response.body.details.problems).toEqual(['item 1: unknown product']);
  });

  it('keeps a product that has orders: it can only stop selling', async () => {
    const campaign = await publishCampaign(seller);
    await checkout(buyer, [
      { listing: itemOf(campaign), quantity: '1' },
    ]).expect(201);
    const [first, second] = sameItems(campaign);

    const dropped = await seller
      .patch(`/campaigns/${campaign.id}`)
      .send(campaignBody({ items: [second] }))
      .expect(409);
    expect(dropped.body.code).toBe('CAMPAIGN_ITEM_HAS_ORDERS');
    expect(dropped.body.details.items[0].title).toBe('Bánh bao chay');

    await seller
      .patch(`/campaigns/${campaign.id}`)
      .send(campaignBody({ items: [{ ...first, selling: false }, second] }))
      .expect(200);

    expect((await preorderItems()).map((item) => item.title)).toEqual([
      'Bánh bao nhân thịt',
    ]);
    const visitor = await signIn(app, identity, 'visitor');
    const seen = await visitor.get(`/campaigns/${campaign.id}`).expect(200);
    expect(seen.body).toMatchObject({ itemCount: 1, minPrice: 18000 });
    expect((seen.body as TestCampaign).items.map((item) => item.title)).toEqual(
      ['Bánh bao nhân thịt'],
    );
    expect((seen.body as TestCampaign).items[0]).toMatchObject({
      orderCount: 0,
      removable: false,
    });

    const own = await seller.get(`/campaigns/${campaign.id}`).expect(200);
    expect((own.body as TestCampaign).items[0]).toMatchObject({
      title: 'Bánh bao chay',
      selling: false,
      orderCount: 1,
      removable: false,
    });
    expect((own.body as TestCampaign).items[1]).toMatchObject({
      selling: true,
      orderCount: 0,
      removable: true,
    });
  });

  it('sells a product again that was not on sale when the round was published', async () => {
    const draft = await createDraft(
      campaignBody({
        items: [itemBody(), itemBody({ title: 'Chè', selling: false })],
      }),
    );
    expect(draft.items[1]).toMatchObject({ title: 'Chè', selling: false });
    await seller.post(`/campaigns/${draft.id}/publish`).expect(200);
    expect((await preorderItems()).map((item) => item.title)).toEqual([
      'Bánh bao chay',
    ]);

    const [first, second] = sameItems(draft);
    await seller
      .patch(`/campaigns/${draft.id}`)
      .send(campaignBody({ items: [first, { ...second, selling: true }] }))
      .expect(200);

    expect((await preorderItems()).map((item) => item.title)).toEqual([
      'Bánh bao chay',
      'Chè',
    ]);
  });

  it('closes a round: nothing can be bought, but it can still be read', async () => {
    const campaign = await publishCampaign(seller);

    const closed = await seller
      .post(`/campaigns/${campaign.id}/close`)
      .expect(200);
    expect(closed.body).toMatchObject({ status: 'closed', isOpen: false });

    expect(await preorderItems()).toEqual([]);
    const seen = await buyer.get(`/campaigns/${campaign.id}`).expect(200);
    expect(seen.body).toMatchObject({ isOpen: false });
    expect((seen.body as TestCampaign).items).toHaveLength(2);

    const patched = await seller
      .patch(`/campaigns/${campaign.id}`)
      .send(campaignBody({ items: sameItems(campaign) }))
      .expect(409);
    expect(patched.body.code).toBe('INVALID_LISTING_STATE');
    const again = await seller
      .post(`/campaigns/${campaign.id}/close`)
      .expect(409);
    expect(again.body.code).toBe('INVALID_LISTING_STATE');
  });

  it('deletes drafts only, and only for their seller', async () => {
    const draft = await createDraft();
    await buyer.delete(`/campaigns/${draft.id}`).expect(403);
    await buyer
      .patch(`/campaigns/${draft.id}`)
      .send(campaignBody())
      .expect(403);
    await buyer.post(`/campaigns/${draft.id}/publish`).expect(403);

    await seller.delete(`/campaigns/${draft.id}`).expect(204);
    await seller.get(`/campaigns/${draft.id}`).expect(404);
    await seller.delete(`/campaigns/${draft.id}`).expect(404);
    const left: unknown[] = await dataSource.query(
      'SELECT 1 FROM listings WHERE campaign_id = $1',
      [draft.id],
    );
    expect(left).toEqual([]);

    const open = await publishCampaign(seller);
    const refused = await seller.delete(`/campaigns/${open.id}`).expect(409);
    expect(refused.body.code).toBe('INVALID_LISTING_STATE');
  });

  it('lists the seller’s rounds newest first with their counts', async () => {
    const older = await publishCampaign(seller);
    await checkout(buyer, [{ listing: itemOf(older), quantity: '1' }]).expect(
      201,
    );
    const newer = await createDraft(
      campaignBody({ title: 'Xôi sáng thứ hai', items: [itemBody()] }),
    );
    // Somebody else's round never shows up.
    await publishCampaign(buyer);

    const response = await seller.get('/campaigns/mine').expect(200);

    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({
      id: newer.id,
      title: 'Xôi sáng thứ hai',
      status: 'draft',
      isOpen: false,
      itemCount: 1,
      orderCount: 0,
      deliveryDate: newer.deliveryDate,
    });
    expect(response.body[1]).toMatchObject({
      id: older.id,
      status: 'open',
      isOpen: true,
      itemCount: 2,
      orderCount: 1,
      orderDeadline: older.orderDeadline,
    });
    expect(response.body[1].createdAt).toEqual(expect.any(String));
  });

  it('keeps the listing routes away from the products of a round', async () => {
    await seller
      .post('/listings')
      .send(inStockBody({ mode: 'preorder', condition: undefined }))
      .expect(400);

    const campaign = await publishCampaign(seller);
    const itemId = campaign.items[0].id;

    const patched = await seller
      .patch(`/listings/${itemId}`)
      .send(inStockBody())
      .expect(409);
    expect(patched.body.code).toBe('INVALID_LISTING_STATE');
    const published = await seller
      .post(`/listings/${itemId}/publish`)
      .expect(409);
    expect(published.body.code).toBe('INVALID_LISTING_STATE');
    const closed = await seller.post(`/listings/${itemId}/close`).expect(409);
    expect(closed.body.code).toBe('INVALID_LISTING_STATE');

    const mine = await seller.get('/users/me/listings').expect(200);
    expect(mine.body).toEqual([]);

    const photo = await sharp({
      create: { width: 80, height: 60, channels: 3, background: '#2b62b2' },
    })
      .jpeg()
      .toBuffer();
    await seller
      .post(`/listings/${itemId}/images`)
      .attach('file', photo, 'photo.jpg')
      .expect(201);
    const detail = await seller.get(`/campaigns/${campaign.id}`).expect(200);
    expect(detail.body.items[0].images).toHaveLength(1);
    expect(detail.body.thumbnails).toHaveLength(1);

    await seller.post(`/campaigns/${campaign.id}/close`).expect(200);
    const late = await seller
      .post(`/listings/${itemId}/images`)
      .attach('file', photo, 'photo.jpg')
      .expect(409);
    expect(late.body.code).toBe('INVALID_LISTING_STATE');
  });

  it('takes an order on a product until the deadline of the round', async () => {
    const campaign = await publishCampaign(seller);

    const placed = await checkout(buyer, [
      { listing: itemOf(campaign), quantity: '2' },
    ]).expect(201);
    const order = placed.body.orders[0] as { id: string };
    expect(order).toMatchObject({
      isPreorder: true,
      totalAmount: 30000,
      listing: { id: campaign.items[0].id, title: 'Bánh bao chay' },
      campaign: {
        id: campaign.id,
        title: 'Bánh bao tuần này',
        orderDeadline: campaign.orderDeadline,
        deliveryDate: campaign.deliveryDate,
      },
    });

    // One live order per person per round, until orders hold several products.
    const second = await checkout(buyer, [
      { listing: itemOf(campaign, 1), quantity: '1' },
    ]).expect(409);
    expect(second.body.code).toBe('ALREADY_ORDERED');
    expect(second.body.details.orderId).toBe(order.id);

    await expireDeadline(campaign.id);
    await redis.flushdb();

    const visitor = await signIn(app, identity, 'visitor');
    const late = await checkout(visitor, [
      { listing: itemOf(campaign), quantity: '1' },
    ]).expect(409);
    expect(late.body.code).toBe('LISTING_NOT_OPEN');

    const cancelled = await buyer
      .post(`/orders/${order.id}/cancel`)
      .send({})
      .expect(409);
    expect(cancelled.body.code).toBe('INVALID_ORDER_STATE');
  });

  describe('browsing open rounds', () => {
    type Summary = {
      id: string;
      title: string;
      itemCount: number;
      minPrice: number;
      thumbnails: string[];
      seller: { id: string; handle: string };
    };
    type Page = { items: Summary[]; nextCursor: string | null };
    const days = (n: number) =>
      new Date(Date.now() + n * 86_400_000).toISOString();
    const page = async (query = ''): Promise<Page> => {
      const response = await buyer.get(`/campaigns${query}`).expect(200);
      return response.body as Page;
    };
    const titles = (p: Page) => p.items.map((item) => item.title);
    const publishAt = (title: string, deadlineDays: number, extra = {}) =>
      publishCampaign(
        seller,
        campaignBody({ title, orderDeadline: days(deadlineDays), ...extra }),
      );
    const photo = () =>
      sharp({
        create: { width: 80, height: 60, channels: 3, background: '#2b62b2' },
      })
        .jpeg()
        .toBuffer();

    it('lists open rounds soonest first, paged by cursor, and leaves out the rest', async () => {
      await publishAt('Ba ngày', 3);
      await publishAt('Một ngày', 1);
      await publishAt('Hai ngày', 2);
      await createDraft(campaignBody({ title: 'Bản nháp tuần' }));
      const closed = await publishAt('Đã đóng', 1);
      await seller.post(`/campaigns/${closed.id}/close`).expect(200);
      const expired = await publishAt('Quá hạn', 1);
      await expireDeadline(expired.id);
      const stopped = await publishAt('Ngừng bán', 1);
      await dataSource.query(
        `UPDATE listings SET status = 'closed' WHERE campaign_id = $1`,
        [stopped.id],
      );

      const all = await page();
      expect(titles(all)).toEqual(['Một ngày', 'Hai ngày', 'Ba ngày']);
      expect(all.nextCursor).toBeNull();

      const first = await page('?limit=2');
      expect(titles(first)).toEqual(['Một ngày', 'Hai ngày']);
      expect(first.nextCursor).toEqual(expect.any(String));
      const second = await page(
        `?limit=2&cursor=${encodeURIComponent(first.nextCursor as string)}`,
      );
      expect(titles(second)).toEqual(['Ba ngày']);
      expect(second.nextCursor).toBeNull();
    });

    it('summarises each round: items on sale, lowest price, seller and thumbnails', async () => {
      const campaign = await publishAt('Có ảnh', 2);
      await seller
        .post(`/listings/${campaign.items[1].id}/images`)
        .attach('file', await photo(), 'photo.jpg')
        .expect(201);

      const { items } = await page();

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: campaign.id,
        itemCount: 2,
        minPrice: 15000,
        seller: { handle: 'seller' },
      });
      expect(items[0].thumbnails).toHaveLength(1);
    });

    it('searches titles of rounds and of their products, ignoring diacritics', async () => {
      await publishCampaign(seller, campaignBody());

      expect(titles(await page('?q=thit'))).toEqual(['Bánh bao tuần này']);
      expect(titles(await page('?q=tuan'))).toEqual(['Bánh bao tuần này']);
      expect((await page('?q=xyz')).items).toEqual([]);
    });

    it('filters by category slug; an unknown slug gives an empty page', async () => {
      await publishCampaign(seller, campaignBody());
      const categories = await buyer.get('/categories').expect(200);
      const food = (
        categories.body as Array<{ id: number; slug: string }>
      ).find((category) => category.id === 2);

      expect(titles(await page(`?category=${food?.slug}`))).toHaveLength(1);
      expect(await page('?category=khong-co-that')).toEqual({
        items: [],
        nextCursor: null,
      });
    });

    it('filters by price: some item must fall in the range', async () => {
      await publishAt('Có món 18k', 1);
      await publishAt('Toàn món 15k', 2, {
        items: [itemBody(), itemBody({ title: 'Bánh bao khác' })],
      });

      expect(titles(await page('?minPrice=16000'))).toEqual(['Có món 18k']);
      expect(titles(await page('?maxPrice=15000'))).toEqual([
        'Có món 18k',
        'Toàn món 15k',
      ]);
      await buyer.get('/campaigns?minPrice=20000&maxPrice=10000').expect(400);
    });

    it('filters by seller', async () => {
      await publishAt('Của người bán', 1);
      const other = await signIn(app, identity, 'other');
      await publishCampaign(
        other,
        campaignBody({ title: 'Của người khác', orderDeadline: days(2) }),
      );

      const mine = await page(
        `?sellerId=${(await seller.get('/users/me')).body.id}`,
      );
      expect(titles(mine)).toEqual(['Của người bán']);
      await buyer.get('/campaigns?sellerId=not-a-uuid').expect(400);
    });

    it('rejects a malformed cursor', async () => {
      await buyer.get('/campaigns?cursor=garbage').expect(400);
    });

    it('shows a new title right after the seller renames the round', async () => {
      const campaign = await publishCampaign(seller);
      expect(titles(await page())).toEqual(['Bánh bao tuần này']);

      await seller
        .patch(`/campaigns/${campaign.id}`)
        .send(campaignBody({ title: 'Tên mới', items: sameItems(campaign) }))
        .expect(200);

      expect(titles(await page())).toEqual(['Tên mới']);
      const detail = await buyer.get(`/campaigns/${campaign.id}`).expect(200);
      expect(detail.body.title).toBe('Tên mới');
    });

    it('hides a draft round from others while the seller still reads it', async () => {
      const draft = await createDraft();
      await buyer.get(`/campaigns/${draft.id}`).expect(404);
      await seller.get(`/campaigns/${draft.id}`).expect(200);
    });
  });

  describe('reopening a finished round', () => {
    const photo = () =>
      sharp({
        create: { width: 80, height: 60, channels: 3, background: '#2b62b2' },
      })
        .jpeg()
        .toBuffer();
    const businessDay = (iso: string) =>
      new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10);
    const dayGap = (deadline: string, delivery: string) =>
      (Date.parse(`${delivery}T00:00:00Z`) -
        Date.parse(`${businessDay(deadline)}T00:00:00Z`)) /
      86_400_000;

    it('refuses a draft and an open round', async () => {
      const draft = await createDraft();
      const refused = await seller
        .post(`/campaigns/${draft.id}/reopen`)
        .expect(409);
      expect(refused.body.code).toBe('INVALID_LISTING_STATE');

      const open = await publishCampaign(seller);
      const again = await seller
        .post(`/campaigns/${open.id}/reopen`)
        .expect(409);
      expect(again.body.code).toBe('INVALID_LISTING_STATE');
    });

    it('is 404 for a missing round and 403 for someone else’s', async () => {
      const campaign = await publishCampaign(seller);
      await seller.post(`/campaigns/${campaign.id}/close`).expect(200);
      await buyer.post(`/campaigns/${campaign.id}/reopen`).expect(403);
      await seller
        .post('/campaigns/6f9619ff-8b86-4011-b42d-00c04fc964ff/reopen')
        .expect(404);
    });

    it('copies the products on sale, with combos and photos, into a new draft', async () => {
      const campaign = await publishCampaign(
        seller,
        campaignBody({
          items: [
            itemBody({
              combos: [{ quantity: '10', price: 140000 }],
            }),
            itemBody({ title: 'Bánh bao ngừng bán', selling: false }),
            itemBody({ title: 'Bánh bao nhân thịt', unitPrice: 18000 }),
          ],
        }),
      );
      await seller
        .post(`/listings/${campaign.items[0].id}/images`)
        .attach('file', await photo(), 'photo.jpg')
        .expect(201);
      await checkout(buyer, [{ listing: itemOf(campaign, 0), quantity: '2' }], {
        paymentMethod: 'pay_on_delivery',
        deliveryLocation: 'Tầng 3',
      }).expect(201);
      await seller.post(`/campaigns/${campaign.id}/close`).expect(200);
      await expireDeadline(campaign.id);
      const before = (await seller.get(`/campaigns/${campaign.id}`)).body;

      const reopened = await seller
        .post(`/campaigns/${campaign.id}/reopen`)
        .expect(201);

      const body = reopened.body;
      expect(body).toMatchObject({
        status: 'draft',
        reopenedFromId: campaign.id,
        title: before.title,
        isOpen: false,
      });
      expect(body.id).not.toBe(campaign.id);
      expect(body.items.map((item: { title: string }) => item.title)).toEqual([
        'Bánh bao chay',
        'Bánh bao nhân thịt',
      ]);
      expect(body.items[0].combos).toEqual(before.items[0].combos);
      expect(body.items[0].combos).toHaveLength(1);
      expect(body.items[0].orderCount).toBe(0);
      expect(body.items[0].images).toHaveLength(1);
      expect(body.items[0].images[0].id).not.toBe(before.items[0].images[0].id);
      expect(body.items[0].images[0].url).not.toBe(
        before.items[0].images[0].url,
      );
      expect(body.items[0].id).not.toBe(before.items[0].id);

      const weeks =
        (Date.parse(body.orderDeadline) - Date.parse(before.orderDeadline)) /
        (7 * 86_400_000);
      expect(Number.isInteger(weeks)).toBe(true);
      expect(weeks).toBeGreaterThan(0);
      expect(Date.parse(body.orderDeadline)).toBeGreaterThan(Date.now());
      expect(dayGap(body.orderDeadline, body.deliveryDate)).toBe(
        dayGap(before.orderDeadline, before.deliveryDate),
      );

      const after = (await seller.get(`/campaigns/${campaign.id}`)).body;
      expect(after).toEqual(before);
      expect(after.items[0].orderCount).toBe(1);
      expect(after.status).toBe('closed');
    });
  });

  describe('concurrent writes to one round', () => {
    it('publishes a draft once when two requests race', async () => {
      const draft = await createDraft();

      const [first, second] = await Promise.all([
        seller.post(`/campaigns/${draft.id}/publish`),
        seller.post(`/campaigns/${draft.id}/publish`),
      ]);

      expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      const loser = first.status === 409 ? first : second;
      expect(loser.body.code).toBe('INVALID_LISTING_STATE');
      const rows: Array<{ published_at: Date }> = await dataSource.query(
        `SELECT published_at FROM campaigns WHERE id = $1`,
        [draft.id],
      );
      const winner = first.status === 200 ? first : second;
      expect(rows[0].published_at.toISOString()).toBe(winner.body.publishedAt);
    });

    it('never leaves a product as a draft inside an open round', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const draft = await createDraft();
        const responses = await Promise.all([
          seller.patch(`/campaigns/${draft.id}`).send(
            campaignBody({
              title: `Bánh bao lần ${attempt}`,
              items: sameItems(draft),
            }),
          ),
          seller.post(`/campaigns/${draft.id}/publish`),
        ]);
        for (const response of responses) {
          expect([200, 409]).toContain(response.status);
        }

        const read = await seller.get(`/campaigns/${draft.id}`).expect(200);
        const round = read.body as TestCampaign;
        const listed = (await preorderItems()).filter(
          (item) => item.campaign?.id === draft.id,
        );
        // The publish may lose to nothing: PATCH never changes the status.
        expect(round.status).toBe('open');
        expect(listed.map((item) => item.id).sort()).toEqual(
          round.items
            .filter((item) => item.selling)
            .map((item) => item.id)
            .sort(),
        );
        const drafts: Array<{ n: number }> = await dataSource.query(
          `SELECT COUNT(*)::int AS n FROM listings
            WHERE campaign_id = $1 AND status = 'draft'`,
          [draft.id],
        );
        expect(drafts[0].n).toBe(0);
      }
    });

    it('does not deadlock a checkout against an edit of the same round', async () => {
      const campaign = await publishCampaign(seller);
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const person = await signIn(app, identity, `buyer-${attempt}`);
        const [placed, edited] = await Promise.all([
          checkout(person, [{ listing: itemOf(campaign), quantity: '1' }]),
          seller.patch(`/campaigns/${campaign.id}`).send(
            campaignBody({
              title: `Bánh bao đợt ${attempt}`,
              items: sameItems(campaign),
            }),
          ),
        ]);
        statuses.push(placed.status, edited.status);
      }
      expect(statuses.filter((status) => status >= 500)).toEqual([]);
      expect(statuses.filter((status) => status === 201)).toHaveLength(10);
      expect(statuses.filter((status) => status === 200)).toHaveLength(10);
    });

    it('does not deadlock a checkout of several products against an edit that lists them in another order', async () => {
      const campaign = await publishCampaign(
        seller,
        campaignBody({
          // Many products keep both transactions busy on the same rows
          // long enough to meet.
          items: Array.from({ length: 12 }, (_, index) =>
            itemBody({ title: `Bánh bao số ${index + 1}` }),
          ),
        }),
      );
      // Checkout takes the product rows in id order; the edit sends them in
      // the opposite order, which is also the order it would write them in.
      const reversed = sameItems(campaign).sort((a, b) =>
        b.id.localeCompare(a.id),
      );
      const purchases = campaign.items.map((_, index) => ({
        listing: itemOf(campaign, index),
        quantity: '1',
      }));
      const attempts = 15;
      const buyersPerAttempt = 3;
      // The edits queue on the round's lock, so together they stay on the
      // product rows for as long as the checkouts take to reach them.
      const editsPerAttempt = 3;
      const placed: number[] = [];
      const edited: number[] = [];
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        // One at a time: signIn passes the identity through a shared slot.
        const people: TestAgent[] = [];
        for (let index = 0; index < buyersPerAttempt; index += 1) {
          people.push(await signIn(app, identity, `buyer-${attempt}-${index}`));
        }
        const [edits, orders] = await Promise.all([
          Promise.all(
            Array.from({ length: editsPerAttempt }, (_, index) =>
              seller.patch(`/campaigns/${campaign.id}`).send(
                campaignBody({
                  title: `Bánh bao đợt ${attempt}.${index}`,
                  items: reversed,
                }),
              ),
            ),
          ),
          Promise.all(people.map((person) => checkout(person, purchases))),
        ]);
        edited.push(...edits.map((edit) => edit.status));
        placed.push(...orders.map((order) => order.status));
      }
      expect([...placed, ...edited].filter((status) => status >= 500)).toEqual(
        [],
      );
      expect(placed.filter((status) => status === 201)).toHaveLength(
        attempts * buyersPerAttempt,
      );
      expect(edited.filter((status) => status === 200)).toHaveLength(
        attempts * editsPerAttempt,
      );
      // Room to report a deadlock (PostgreSQL waits a second before each)
      // as a 500 rather than as a timeout.
    }, 60_000);
  });
});
