import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { Channel } from 'amqplib';
import { DataSource } from 'typeorm';
import { TransactionRunner } from '../src/database/transaction.js';
import { OutboxRepository } from '../src/events/outbox.repository.js';
import { OutboxService } from '../src/events/outbox.service.js';
import { OutboxRelay } from '../src/worker/outbox-relay.js';
import { RabbitClient } from '../src/worker/rabbit.client.js';
import { createTestApp } from './utils/create-test-app.js';
import {
  ensureTestVhost,
  openTestChannel,
  purgeAll,
} from './utils/rabbit.js';
import { waitFor } from './utils/wait-for.js';

describe('Worker: topology and outbox relay', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let rabbit: RabbitClient;
  let relay: OutboxRelay;
  let channel: Channel;
  let closeChannel: () => Promise<void>;

  const addEvent = (event: Parameters<OutboxService['add']>[1]) =>
    app
      .get(TransactionRunner)
      .run((tx) => app.get(OutboxService).add(tx, event));

  beforeAll(async () => {
    await ensureTestVhost();
    app = await createTestApp({ current: null });
    dataSource = app.get(DataSource);
    rabbit = new RabbitClient(
      new ConfigService({ RABBITMQ_URL: process.env.RABBITMQ_URL }) as never,
    );
    await rabbit.waitForConnect();
    relay = new OutboxRelay(app.get(OutboxRepository), rabbit);
    ({ channel, close: closeChannel } = await openTestChannel());
  });

  beforeEach(async () => {
    await purgeAll(channel);
    await dataSource.query('DELETE FROM outbox_events');
  });

  afterAll(async () => {
    await relay.stop();
    await closeChannel();
    await rabbit.close();
    await app.close();
  });

  it('publishes an order event to the in-app queue and marks it sent', async () => {
    const envelope = await addEvent({
      type: 'order.placed',
      payload: { orderId: 'o-1' },
    } as never);

    await expect(relay.runOnce()).resolves.toBe(1);

    const message = await waitFor(async () => {
      const got = await channel.get('notifications.inapp', { noAck: true });
      if (!got) throw new Error('no message yet');
      return got;
    });
    expect(JSON.parse(message.content.toString())).toEqual(envelope);
    const rows: { published_at: Date | null }[] = await dataSource.query(
      'SELECT published_at FROM outbox_events WHERE id = $1',
      [envelope.id],
    );
    expect(rows[0].published_at).not.toBeNull();
    await expect(relay.runOnce()).resolves.toBe(0);
  });

  it('routes a campaign event to the Google Chat queue only', async () => {
    await addEvent({
      type: 'campaign.opened',
      payload: { campaignId: 'c-1' },
    } as never);

    await expect(relay.runOnce()).resolves.toBe(1);

    await waitFor(async () => {
      const got = await channel.get('notifications.gchat', { noAck: true });
      if (!got) throw new Error('no message yet');
    });
    expect(await channel.get('notifications.inapp', { noAck: true })).toBe(
      false,
    );
  });
});
