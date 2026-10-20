import type { Tx } from '../database/transaction.js';
import type { OutboxRepository } from '../events/outbox.repository.js';
import { OutboxRelay } from './outbox-relay.js';
import type { RabbitClient } from './rabbit.client.js';

const tx = {} as Tx;
const occurredAt = new Date('2026-10-01T00:00:00.000Z');
const row = (id: string, type = 'order.placed') => ({
  id,
  type,
  payload: { orderId: id },
  occurredAt,
});

describe('OutboxRelay', () => {
  let outbox: {
    transaction: ReturnType<typeof vi.fn>;
    lockUnpublished: ReturnType<typeof vi.fn>;
    markPublished: ReturnType<typeof vi.fn>;
    bumpAttempts: ReturnType<typeof vi.fn>;
  };
  let rabbit: { publish: ReturnType<typeof vi.fn> };
  let relay: OutboxRelay;
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    outbox = {
      transaction: vi.fn((work: (t: Tx) => Promise<unknown>) => work(tx)),
      lockUnpublished: vi.fn().mockResolvedValue([]),
      markPublished: vi.fn().mockResolvedValue(undefined),
      bumpAttempts: vi.fn().mockResolvedValue(undefined),
    };
    rabbit = { publish: vi.fn().mockResolvedValue(undefined) };
    relay = new OutboxRelay(
      outbox as unknown as OutboxRepository,
      rabbit as unknown as RabbitClient,
    );
    vi.spyOn(relay['logger'], 'warn').mockImplementation(() => undefined);
    logError = vi
      .spyOn(relay['logger'], 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes every row and marks them published', async () => {
    outbox.lockUnpublished.mockResolvedValue([row('a'), row('b')]);

    await expect(relay.runOnce()).resolves.toBe(2);

    expect(rabbit.publish).toHaveBeenCalledTimes(2);
    const [key, body, options] = rabbit.publish.mock.calls[0] as [
      string,
      Buffer,
      object,
    ];
    expect(key).toBe('order.placed');
    expect(JSON.parse(body.toString())).toEqual({
      id: 'a',
      type: 'order.placed',
      version: 1,
      occurredAt: occurredAt.toISOString(),
      payload: { orderId: 'a' },
    });
    expect(options).toEqual({ messageId: 'a', type: 'order.placed' });
    expect(outbox.markPublished).toHaveBeenCalledWith(
      tx,
      ['a', 'b'],
      expect.any(Date),
    );
    expect(outbox.bumpAttempts).not.toHaveBeenCalled();
  });

  it('stops the batch at the first failure and leaves later rows untouched', async () => {
    outbox.lockUnpublished.mockResolvedValue([row('a'), row('b'), row('c')]);
    rabbit.publish
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('nack'));

    await expect(relay.runOnce()).resolves.toBe(1);

    expect(outbox.markPublished).toHaveBeenCalledWith(
      tx,
      ['a'],
      expect.any(Date),
    );
    expect(outbox.bumpAttempts).toHaveBeenCalledWith(tx, ['b']);
    expect(rabbit.publish).toHaveBeenCalledTimes(2);
  });

  it('does nothing without rows', async () => {
    await expect(relay.runOnce()).resolves.toBe(0);
    expect(rabbit.publish).not.toHaveBeenCalled();
    expect(outbox.markPublished).not.toHaveBeenCalled();
  });

  it('runs every interval and survives a failing pass', async () => {
    vi.useFakeTimers();
    outbox.transaction.mockRejectedValueOnce(new Error('db down'));

    relay.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(outbox.transaction).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(outbox.transaction).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalled();

    await relay.stop();
  });

  it('ignores a second start while running', async () => {
    vi.useFakeTimers();
    relay.start();
    relay.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(outbox.transaction).toHaveBeenCalledTimes(1);
    await relay.stop();
  });

  it('stop waits for the running pass and starts no more', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    outbox.transaction.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(0);
        }),
    );

    relay.start();
    await vi.advanceTimersByTimeAsync(1000);
    let stopped = false;
    const stopping = relay.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect(stopped).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(outbox.transaction).toHaveBeenCalledTimes(1);
  });
});
