import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import type { Channel } from 'amqplib';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import {
  CHAT_TEMPLATE_TYPES,
  DEFAULT_TEMPLATES,
} from '../src/modules/chat-channel/chat-templates.js';
import { ChatDeliveryService } from '../src/modules/chat-channel/chat-delivery.service.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';
import { createTestWorker } from './utils/create-test-worker.js';
import { startFakeChat } from './utils/fake-chat.js';
import {
  campaignBody,
  inStockBody,
  publish,
  publishCampaign,
} from './utils/market.js';
import { openTestChannel, purgeAll } from './utils/rabbit.js';
import { waitFor } from './utils/wait-for.js';

const WEBHOOK =
  'https://chat.googleapis.com/v1/spaces/TEST/messages?key=k&token=t';
const bank = {
  bankBin: '970436',
  bankAccountNumber: '0123456789',
  bankAccountName: 'Nguyen Van An',
};

type Delivery = {
  event_id: string;
  event_type: string;
  outcome: string;
  message: string | null;
  seller_id: string | null;
};

describe('Google Chat delivery from events', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let worker: TestingModule;
  let dataSource: DataSource;
  let redis: Redis;
  let channel: Channel;
  let closeChannel: () => Promise<void>;
  let fake: Awaited<ReturnType<typeof startFakeChat>>;
  let seller: TestAgent;

  const deliveries = (outcome?: string): Promise<Delivery[]> =>
    dataSource.query(
      `SELECT event_id, event_type, outcome, message, seller_id
       FROM chat_deliveries WHERE ($1::text IS NULL OR outcome::text = $1)
       ORDER BY created_at, id`,
      [outcome ?? null],
    );
  const waitForRows = (outcome: string, count: number): Promise<Delivery[]> =>
    waitFor(async () => {
      const rows = await deliveries(outcome);
      if (rows.length !== count) throw new Error(`${rows.length} rows`);
      return rows;
    });
  const setSettings = (maxPerHour: number, cooldown: number) =>
    dataSource.query(
      `UPDATE chat_channel_settings SET enabled = true, webhook_url = $1,
         max_per_hour = $2, seller_cooldown_minutes = $3 WHERE id = 1`,
      [WEBHOOK, maxPerHour, cooldown],
    );
  const setListingTemplate = (enabled: boolean) =>
    dataSource.query(
      `UPDATE chat_templates SET enabled = $1 WHERE event_type = 'listing.published'`,
      [enabled],
    );

  beforeAll(async () => {
    fake = await startFakeChat();
    app = await createTestApp(identity, { chatFetch: fake.fetch });
    dataSource = app.get(DataSource);
    redis = app.get<Redis>(REDIS_CLIENT);
    ({ channel, close: closeChannel } = await openTestChannel());
    await purgeAll(channel);
    worker = await createTestWorker({ fetch: fake.fetch });
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('DELETE FROM outbox_events');
    await dataSource.query('DELETE FROM chat_deliveries');
    await purgeAll(channel);
    await redis.flushdb();
    for (const type of CHAT_TEMPLATE_TYPES) {
      await dataSource.query(
        'UPDATE chat_templates SET enabled = $2, template = $3 WHERE event_type = $1',
        [type, type !== 'listing.published', DEFAULT_TEMPLATES[type]],
      );
    }
    await setSettings(10, 30);
    fake.received.length = 0;
    fake.respondWith(200);
    seller = await signIn(app, identity, 'seller');
    await seller.patch('/users/me').send(bank).expect(200);
  });

  afterAll(async () => {
    await worker.close();
    await closeChannel();
    await app.close();
    await fake.close();
  });

  it('posts a published round to the webhook and logs it as sent', async () => {
    const round = await publishCampaign(seller);

    const [row] = await waitForRows('sent', 1);
    expect(fake.received).toHaveLength(1);
    const { text } = fake.received[0];
    const deadline = new Date(
      new Date(round.orderDeadline).getTime() + 7 * 3_600_000,
    );
    const pad = (n: number) => String(n).padStart(2, '0');
    const expectedDeadline = `${pad(deadline.getUTCHours())}:${pad(deadline.getUTCMinutes())} ${pad(deadline.getUTCDate())}/${pad(deadline.getUTCMonth() + 1)}`;
    expect(text).toContain('seller');
    expect(text).toContain(round.title);
    expect(text).toContain(expectedDeadline);
    expect(text).toContain(`http://localhost:3000/campaigns/${round.id}`);
    expect(row.message).toBe(text);
    expect(row.event_type).toBe('campaign.opened');
  });

  it('holds a second round from the same seller during the cooldown', async () => {
    await publishCampaign(seller);
    await waitForRows('sent', 1);

    const second = await publishCampaign(
      seller,
      campaignBody({ title: 'Trà sữa tuần sau' }),
    );
    const [held] = await waitForRows('rate_limited_seller', 1);

    expect(fake.received).toHaveLength(1);
    expect(held.message).toContain(second.title);
    expect(held.message).toContain(`/campaigns/${second.id}`);
  });

  it('holds messages above the hourly limit', async () => {
    await setSettings(1, 0);
    await publishCampaign(seller);
    await waitForRows('sent', 1);

    const other = await signIn(app, identity, 'other');
    await publishCampaign(other, campaignBody({ title: 'Round của other' }));
    const [held] = await waitForRows('rate_limited_global', 1);

    expect(fake.received).toHaveLength(1);
    expect(held.message).toContain('Round của other');
  });

  it('sends a published product only once its template is enabled', async () => {
    await publish(seller, inStockBody({ title: 'Máy xay sinh tố' }));
    // The relay is FIFO: once this round is delivered, the product event
    // before it has reached the worker and been skipped.
    await publishCampaign(seller);
    await waitForRows('sent', 1);
    expect(fake.received).toHaveLength(1);
    expect(fake.received[0].text).not.toContain('Máy xay sinh tố');
    expect(await deliveries()).toHaveLength(1);

    await setListingTemplate(true);
    await publish(seller, inStockBody({ title: 'Loa kéo' }));
    await waitForRows('sent', 2);
    expect(fake.received).toHaveLength(2);
    expect(fake.received[1].text).toContain('Loa kéo');
    expect(fake.received[1].text).toContain('500.000 ₫');
  });

  it('does not call the webhook again for a redelivered event', async () => {
    const round = await publishCampaign(seller);
    const [sent] = await waitForRows('sent', 1);
    const [outbox] = await dataSource.query(
      'SELECT id, type, occurred_at, payload FROM outbox_events WHERE id = $1',
      [sent.event_id],
    );
    expect(round.id).toBeDefined();

    channel.publish(
      'ssmarket.events',
      outbox.type,
      Buffer.from(
        JSON.stringify({
          id: outbox.id,
          version: 1,
          type: outbox.type,
          occurredAt: new Date(outbox.occurred_at).toISOString(),
          payload: outbox.payload,
        }),
      ),
      { persistent: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(fake.received).toHaveLength(1);
    expect(await deliveries()).toHaveLength(1);
  });

  describe('hourly digest', () => {
    const now = new Date('2026-10-15T03:00:30.000Z'); // 10:00:30 in Vietnam
    const previousHour = new Date('2026-10-15T02:30:00.000Z');
    const currentHour = new Date('2026-10-15T03:00:10.000Z');
    const digest = () => worker.get(ChatDeliveryService).runDigest(now);
    const hold = (
      message: string,
      createdAt: Date,
      outcome = 'rate_limited_seller',
    ) =>
      dataSource.query(
        `INSERT INTO chat_deliveries (event_type, outcome, message, created_at)
         VALUES ('campaign.opened', $1, $2, $3)`,
        [outcome, message, createdAt],
      );
    const digestedCount = async (): Promise<number> =>
      Number(
        (
          await dataSource.query(
            'SELECT count(*) FROM chat_deliveries WHERE digested_at IS NOT NULL',
          )
        )[0].count,
      );

    it('sends one message with the held rows, marks them, and not twice', async () => {
      await hold('Tin một', previousHour);
      await hold(
        'Tin hai',
        new Date(previousHour.getTime() + 1),
        'rate_limited_global',
      );
      await hold('Tin ba', new Date(previousHour.getTime() + 2));

      await digest();

      expect(fake.received).toHaveLength(1);
      const { text } = fake.received[0];
      expect(text.startsWith('📋')).toBe(true);
      for (const line of ['• Tin một', '• Tin hai', '• Tin ba']) {
        expect(text).toContain(line);
      }
      expect(await deliveries('digest')).toHaveLength(1);
      expect(await digestedCount()).toBe(3);

      await digest();
      expect(fake.received).toHaveLength(1);
    });

    it('sends nothing without held rows', async () => {
      await digest();
      expect(fake.received).toHaveLength(0);
      expect(await deliveries()).toHaveLength(0);
    });

    it('marks rows digested without sending when chat.digest is disabled', async () => {
      await dataSource.query(
        "UPDATE chat_templates SET enabled = false WHERE event_type = 'chat.digest'",
      );
      await hold('Tin một', previousHour);
      await digest();
      expect(fake.received).toHaveLength(0);
      expect(await digestedCount()).toBe(1);
      expect(await deliveries('digest')).toHaveLength(0);
    });

    it('leaves a row of the current hour for the next digest', async () => {
      await hold('Tin cũ', previousHour);
      await hold('Tin mới', currentHour);
      await digest();
      expect(fake.received).toHaveLength(1);
      expect(fake.received[0].text).toContain('Tin cũ');
      expect(fake.received[0].text).not.toContain('Tin mới');
      expect(await digestedCount()).toBe(1);
    });
  });
});
