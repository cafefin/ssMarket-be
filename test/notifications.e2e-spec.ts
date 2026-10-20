import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import type { Channel } from 'amqplib';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';
import { createTestWorker } from './utils/create-test-worker.js';
import {
  checkout,
  inStockBody,
  itemOf,
  publish,
  publishCampaign,
  type TestListing,
} from './utils/market.js';
import { openTestChannel, purgeAll } from './utils/rabbit.js';
import { waitFor } from './utils/wait-for.js';

type Placed = { id: string; code: string; totalAmount: number };
type Row = {
  type: string;
  params: Record<string, unknown>;
  read_at: Date | null;
  recipient: string;
};

const bank = {
  bankBin: '970436',
  bankAccountNumber: '0123456789',
  bankAccountName: 'Nguyen Van An',
};

describe('In-app notifications from order events', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let worker: TestingModule;
  let dataSource: DataSource;
  let channel: Channel;
  let closeChannel: () => Promise<void>;
  let seller: TestAgent;
  let buyer: TestAgent;
  let sellerId: string;
  let buyerId: string;

  const rowsOf = (type?: string): Promise<Row[]> =>
    dataSource.query(
      `SELECT n.type, n.params, n.read_at, u.email AS recipient
       FROM notifications n JOIN users u ON u.id = n.recipient_id
       WHERE ($1::text IS NULL OR n.type = $1) ORDER BY n.created_at, n.id`,
      [type ?? null],
    );
  const idOf = async (name: string): Promise<string> =>
    (
      (await dataSource.query('SELECT id FROM users WHERE email = $1', [
        `${name}@example.com`,
      ])) as { id: string }[]
    )[0].id;
  const buy = async (listing: TestListing): Promise<Placed> =>
    (
      (
        await checkout(buyer, [{ listing, quantity: '1' }], {
          paymentMethod: 'prepaid_qr',
        }).expect(201)
      ).body as { orders: Placed[] }
    ).orders[0];

  beforeAll(async () => {
    app = await createTestApp(identity);
    dataSource = app.get(DataSource);
    ({ channel, close: closeChannel } = await openTestChannel());
    await purgeAll(channel);
    worker = await createTestWorker();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('DELETE FROM outbox_events');
    await purgeAll(channel);
    seller = await signIn(app, identity, 'seller');
    buyer = await signIn(app, identity, 'buyer');
    sellerId = await idOf('seller');
    buyerId = await idOf('buyer');
    await seller.patch('/users/me').send(bank).expect(200);
  });

  afterAll(async () => {
    await worker.close();
    await closeChannel();
    await app.close();
  });

  it('tells the seller about a new order and nobody else', async () => {
    const listing = await publish(seller, inStockBody());
    const placed = await buy(listing);

    const rows = await waitFor(async () => {
      const found = await rowsOf('order.placed');
      if (found.length === 0) throw new Error('not yet');
      return found;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].recipient).toBe('seller@example.com');
    expect(rows[0].params).toMatchObject({
      orderCode: placed.code,
      role: 'seller',
    });
    expect(
      await dataSource.query(
        'SELECT 1 FROM notifications WHERE recipient_id = $1',
        [buyerId],
      ),
    ).toEqual([]);
    expect(sellerId).not.toBe(buyerId);
  });

  it('records a redelivered event once', async () => {
    const listing = await publish(seller, inStockBody());
    await buy(listing);
    await waitFor(async () => {
      if ((await rowsOf('order.placed')).length === 0) throw new Error('wait');
    });
    const [outbox]: { id: string; type: string; envelope?: unknown }[] =
      await dataSource.query(
        `SELECT * FROM outbox_events WHERE type = 'order.placed'`,
      );
    const envelope = {
      id: outbox.id,
      version: 1,
      type: outbox.type,
      occurredAt: new Date(
        (outbox as unknown as { occurred_at: Date }).occurred_at,
      ).toISOString(),
      payload: (outbox as unknown as { payload: unknown }).payload,
    };

    channel.publish(
      'ssmarket.events',
      envelope.type,
      Buffer.from(JSON.stringify(envelope)),
      { persistent: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await rowsOf('order.placed')).toHaveLength(1);
  });

  it('merges unread edits into one row and starts a new one after reading', async () => {
    const round = await publishCampaign(seller);
    const item = itemOf(round, 0);
    const placed = (
      (
        await checkout(buyer, [{ listing: item, quantity: '1' }], {
          paymentMethod: 'pay_on_delivery',
        }).expect(201)
      ).body as { orders: Placed[] }
    ).orders[0];
    const edit = (quantity: string) =>
      buyer
        .patch(`/orders/${placed.id}`)
        .send({
          lines: [{ listingId: item.id, quantity }],
          paymentMethod: 'pay_on_delivery',
          deliveryLocation: 'Tầng 7',
        })
        .expect(200);
    const waitForTotal = (total: number, count: number) =>
      waitFor(async () => {
        const rows = await rowsOf('order.edited');
        if (rows.length !== count || rows[count - 1].params.total !== total) {
          throw new Error('not yet');
        }
        return rows;
      });

    await edit('2');
    await waitForTotal(30000, 1);
    await edit('3');
    const merged = await waitForTotal(45000, 1);
    expect(merged[0].read_at).toBeNull();

    await dataSource.query(
      `UPDATE notifications SET read_at = now() WHERE type = 'order.edited'`,
    );
    await edit('4');
    const rows = await waitForTotal(60000, 2);
    expect(rows[0].params.total).toBe(45000);
    expect(rows[0].read_at).not.toBeNull();
  }, 20_000);

  it('tells the buyer when payment is confirmed', async () => {
    const listing = await publish(seller, inStockBody());
    const placed = await buy(listing);
    await buyer.post(`/orders/${placed.id}/report-payment`).expect(200);
    await seller.post(`/orders/${placed.id}/confirm-payment`).expect(200);

    const rows = await waitFor(async () => {
      const found = await rowsOf('order.payment_confirmed');
      if (found.length === 0) throw new Error('not yet');
      return found;
    });

    expect(rows[0].recipient).toBe('buyer@example.com');
    expect(rows[0].params).toMatchObject({ role: 'buyer' });
  });
});

describe('Notifications API', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let me: TestAgent;
  let other: TestAgent;
  let meId: string;
  let otherId: string;

  type Item = { id: string; readAt: string | null; createdAt: string };
  type Page = { items: Item[]; nextCursor: string | null };

  const seed = async (
    recipientId: string,
    count: number,
    read = false,
  ): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const rows = (await dataSource.query(
        `INSERT INTO notifications (recipient_id, event_id, type, params, created_at, read_at)
         VALUES ($1, gen_random_uuid(), 'order.placed', '{"orderCode":"SS-1"}',
                 now() - ($2 || ' seconds')::interval, $3)
         RETURNING id`,
        [recipientId, String(i + 1), read ? new Date() : null],
      )) as { id: string }[];
      ids.push(rows[0].id);
    }
    return ids;
  };
  const unread = async (agent: TestAgent): Promise<number> =>
    (
      (await agent.get('/notifications/unread-count').expect(200)).body as {
        count: number;
      }
    ).count;

  beforeAll(async () => {
    app = await createTestApp(identity);
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    me = await signIn(app, identity, 'me');
    other = await signIn(app, identity, 'other');
    meId = (
      (await dataSource.query(`SELECT id FROM users WHERE email = 'me@example.com'`)) as {
        id: string;
      }[]
    )[0].id;
    otherId = (
      (await dataSource.query(`SELECT id FROM users WHERE email = 'other@example.com'`)) as {
        id: string;
      }[]
    )[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 401 without a session', async () => {
    const anon = request(app.getHttpServer());
    const id = '00000000-0000-4000-8000-000000000001';
    await anon.get('/notifications').expect(401);
    await anon.get('/notifications/unread-count').expect(401);
    await anon.post(`/notifications/${id}/read`).expect(401);
    await anon.post('/notifications/read-all').expect(401);
  });

  it('pages newest first with a keyset cursor', async () => {
    await seed(meId, 25);
    await seed(otherId, 3);
    const first = (await me.get('/notifications').expect(200)).body as Page;
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const times = first.items.map((i) => Date.parse(i.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(first.items[0]).toMatchObject({
      type: 'order.placed',
      params: { orderCode: 'SS-1' },
      readAt: null,
    });

    const second = (
      await me.get('/notifications').query({ cursor: first.nextCursor }).expect(200)
    ).body as Page;
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const all = new Set([...first.items, ...second.items].map((i) => i.id));
    expect(all.size).toBe(25);
  });

  it('rejects an invalid cursor', async () => {
    await me.get('/notifications').query({ cursor: 'nope' }).expect(400);
  });

  it('counts only the caller\'s unread rows', async () => {
    await seed(meId, 3);
    await seed(meId, 2, true);
    await seed(otherId, 4);
    expect(await unread(me)).toBe(3);
    expect(await unread(other)).toBe(4);
  });

  it('marks one as read, idempotently, and never someone else\'s', async () => {
    const [mine] = await seed(meId, 2);
    const [theirs] = await seed(otherId, 1);

    await me.post(`/notifications/${mine}/read`).expect(204);
    expect(await unread(me)).toBe(1);
    const page = (await me.get('/notifications').expect(200)).body as Page;
    expect(page.items.find((i) => i.id === mine)?.readAt).not.toBeNull();
    const firstRead = (await dataSource.query(
      'SELECT read_at FROM notifications WHERE id = $1',
      [mine],
    )) as { read_at: Date }[];

    await me.post(`/notifications/${mine}/read`).expect(204);
    const secondRead = (await dataSource.query(
      'SELECT read_at FROM notifications WHERE id = $1',
      [mine],
    )) as { read_at: Date }[];
    expect(secondRead[0].read_at).toEqual(firstRead[0].read_at);

    await me.post(`/notifications/${theirs}/read`).expect(404);
    expect(await unread(other)).toBe(1);
    await me
      .post('/notifications/00000000-0000-4000-8000-0000000000ff/read')
      .expect(404);
    await me.post('/notifications/not-a-uuid/read').expect(400);
  });

  it('read-all marks only the caller\'s rows', async () => {
    await seed(meId, 3);
    await seed(otherId, 2);
    await me.post('/notifications/read-all').expect(204);
    expect(await unread(me)).toBe(0);
    expect(await unread(other)).toBe(2);
  });
});
