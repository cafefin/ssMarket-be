import { Logger } from '@nestjs/common';
import { QueueConsumer } from './queue-consumer.js';
import { WorkerRunner } from './worker.runner.js';
import type { RabbitClient } from './rabbit.client.js';
import type { OutboxRelay } from './outbox-relay.js';
import type { Maintenance } from './maintenance.js';

describe('WorkerRunner', () => {
  const calls: string[] = [];
  const rabbit = {
    waitForConnect: vi.fn(async () => {
      calls.push('connect');
    }),
    consume: vi.fn(async (queue: string) => {
      calls.push(`consume ${queue}`);
      return `tag-${queue}`;
    }),
    cancel: vi.fn(async (tag: string) => {
      calls.push(`cancel ${tag}`);
    }),
    close: vi.fn(async () => {
      calls.push('close');
    }),
  };
  const relay = {
    start: vi.fn(() => calls.push('relay start')),
    stop: vi.fn(async () => {
      calls.push('relay stop');
    }),
  };
  const maintenance = {
    start: vi.fn(() => calls.push('maintenance start')),
    stop: vi.fn(async () => {
      calls.push('maintenance stop');
    }),
  };

  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  it('starts consumers, relay, ticker; stops in reverse and closes rabbit', async () => {
    const runner = new WorkerRunner(
      rabbit as unknown as RabbitClient,
      relay as unknown as OutboxRelay,
      maintenance as unknown as Maintenance,
      { a: async () => {}, b: async () => {} },
    );
    await runner.onApplicationBootstrap();
    expect(calls).toEqual([
      'connect',
      'consume a',
      'consume b',
      'relay start',
      'maintenance start',
    ]);
    calls.length = 0;
    await runner.beforeApplicationShutdown();
    expect(calls).toEqual([
      'maintenance stop',
      'relay stop',
      'cancel tag-a',
      'cancel tag-b',
      'close',
    ]);
  });

  it('still closes the client when a consumer fails to stop', async () => {
    const logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const runner = new WorkerRunner(
      rabbit as unknown as RabbitClient,
      relay as unknown as OutboxRelay,
      maintenance as unknown as Maintenance,
      { a: async () => {}, b: async () => {} },
    );
    await runner.onApplicationBootstrap();
    calls.length = 0;
    vi.spyOn(QueueConsumer.prototype, 'stop').mockRejectedValueOnce(
      new Error('stuck'),
    );
    rabbit.close.mockRejectedValueOnce(new Error('close failed'));

    await expect(runner.beforeApplicationShutdown()).resolves.toBeUndefined();
    expect(rabbit.close).toHaveBeenCalled();
    const logged = logError.mock.calls.map((call) => String(call[0]));
    expect(logged.some((text) => text.includes('stuck'))).toBe(true);
    expect(logged.some((text) => text.includes('close failed'))).toBe(true);
  });
});
