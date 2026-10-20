import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import type { Channel } from 'amqplib';
import { DataSource } from 'typeorm';
import { TransactionRunner } from '../src/database/transaction.js';
import { OutboxRepository } from '../src/events/outbox.repository.js';
import { OutboxService } from '../src/events/outbox.service.js';
import { OutboxRelay } from '../src/worker/outbox-relay.js';
import { QueueConsumer } from '../src/worker/queue-consumer.js';
import { RabbitClient } from '../src/worker/rabbit.client.js';
import { createTestApp } from './utils/create-test-app.js';
import { createTestWorker } from './utils/create-test-worker.js';
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

describe('Worker: running consumers', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let worker: TestingModule | undefined;
  let channel: Channel;
  let closeChannel: () => Promise<void>;

  beforeAll(async () => {
    await ensureTestVhost();
    app = await createTestApp({ current: null });
    dataSource = app.get(DataSource);
    ({ channel, close: closeChannel } = await openTestChannel());
  });

  afterAll(async () => {
    await worker?.close();
    await closeChannel();
    await app.close();
  });

  it('publishes an outbox row and the queues end up empty', async () => {
    await dataSource.query('DELETE FROM outbox_events');
    worker = await createTestWorker();
    await purgeAll(channel);
    const envelope = await app
      .get(TransactionRunner)
      .run((tx) =>
        app.get(OutboxService).add(tx, {
          type: 'order.placed',
          payload: { orderId: 'o-1' },
        } as never),
      );

    await waitFor(async () => {
      const rows: { published_at: Date | null }[] = await dataSource.query(
        'SELECT published_at FROM outbox_events WHERE id = $1',
        [envelope.id],
      );
      if (rows[0].published_at === null) throw new Error('not published yet');
    });
    await waitFor(async () => {
      for (const queue of ['notifications.inapp', 'notifications.gchat']) {
        const info = await channel.checkQueue(queue);
        if (info.messageCount !== 0) throw new Error(`${queue} not empty`);
      }
    });
  });

  it('stops gracefully', async () => {
    await expect(worker?.close()).resolves.toBeUndefined();
    worker = undefined;
  });
});

describe('Worker: retry and dead-letter (no worker running)', () => {
  let rabbit: RabbitClient;
  let channel: Channel;
  let closeChannel: () => Promise<void>;
  const logger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  const QUEUE = 'notifications.inapp';
  const body = Buffer.from(
    JSON.stringify({
      id: 'e-1',
      type: 'order.placed',
      version: 1,
      occurredAt: new Date().toISOString(),
      payload: {},
    }),
  );

  beforeAll(async () => {
    await ensureTestVhost();
    rabbit = new RabbitClient(
      new ConfigService({ RABBITMQ_URL: process.env.RABBITMQ_URL }) as never,
    );
    await rabbit.waitForConnect();
    ({ channel, close: closeChannel } = await openTestChannel());
  });

  beforeEach(async () => {
    await purgeAll(channel);
  });

  afterAll(async () => {
    await closeChannel();
    await rabbit.close();
  });

  const throwingConsumer = () =>
    new QueueConsumer(
      rabbit,
      QUEUE,
      async () => {
        throw new Error('boom');
      },
      logger,
    );

  // The consumer acks and rejects on its own channel, so the message is first
  // delivered to it through consume() rather than fetched with channel.get.
  it('moves a failing message to the retry queue', async () => {
    channel.sendToQueue(QUEUE, body, { persistent: true });
    const consumer = throwingConsumer();
    await consumer.start(1);
    await waitFor(async () => {
      const info = await channel.checkQueue(`${QUEUE}.retry`);
      if (info.messageCount !== 1) throw new Error('not in retry yet');
    });
    await consumer.stop();
    expect((await channel.checkQueue(QUEUE)).messageCount).toBe(0);
  });

  it('moves a message to the DLQ after the last attempt', async () => {
    channel.sendToQueue(QUEUE, body, {
      persistent: true,
      headers: {
        'x-death': [{ queue: QUEUE, reason: 'rejected', count: 4 }],
      },
    });
    const consumer = throwingConsumer();
    await consumer.start(1);
    await waitFor(async () => {
      const info = await channel.checkQueue(`${QUEUE}.dlq`);
      if (info.messageCount !== 1) throw new Error('not in DLQ yet');
    });
    await consumer.stop();
    expect((await channel.checkQueue(`${QUEUE}.retry`)).messageCount).toBe(0);
  });
});
