import type { LoggerService } from '@nestjs/common';
import type { RabbitClient, RabbitMessage } from './rabbit.client.js';
import { QueueConsumer } from './queue-consumer.js';

const QUEUE = 'notifications.inapp';
const envelope = {
  id: 'e-1',
  type: 'order.placed',
  version: 1,
  occurredAt: '2026-01-01T00:00:00.000Z',
  payload: { orderId: 'o-1' },
};

const message = (
  body: string,
  headers?: Record<string, unknown>,
): RabbitMessage => ({
  content: Buffer.from(body),
  headers,
  raw: {} as never,
});

describe('QueueConsumer', () => {
  let rabbit: {
    ack: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
    sendToQueue: ReturnType<typeof vi.fn>;
    consume: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  let logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  const handler = vi.fn();

  const make = () =>
    new QueueConsumer(
      rabbit as unknown as RabbitClient,
      QUEUE,
      handler,
      logger as unknown as LoggerService,
    );

  beforeEach(() => {
    handler.mockReset();
    rabbit = {
      ack: vi.fn(),
      reject: vi.fn(),
      sendToQueue: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue('tag-1'),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    logger = { warn: vi.fn(), error: vi.fn() };
  });

  it('acks after the handler succeeds', async () => {
    handler.mockResolvedValue(undefined);
    const m = message(JSON.stringify(envelope));
    await make().handle(m);
    expect(handler).toHaveBeenCalledWith(envelope);
    expect(rabbit.ack).toHaveBeenCalledWith(m);
  });

  it('rejects to the retry queue on the first failure', async () => {
    handler.mockRejectedValue(new Error('boom'));
    await make().handle(message(JSON.stringify(envelope)));
    expect(rabbit.reject).toHaveBeenCalledTimes(1);
    expect(rabbit.ack).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`${QUEUE}: order.placed e-1 failed (attempt 1/5)`),
    );
  });

  it('dead-letters after the last attempt', async () => {
    handler.mockRejectedValue(new Error('boom'));
    const headers = {
      'x-death': [{ queue: QUEUE, reason: 'rejected', count: 4 }],
    };
    const m = message(JSON.stringify(envelope), headers);
    await make().handle(m);
    expect(rabbit.sendToQueue).toHaveBeenCalledWith(
      `${QUEUE}.dlq`,
      m.content,
      headers,
    );
    expect(rabbit.ack).toHaveBeenCalledWith(m);
    expect(rabbit.reject).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('sends an unreadable body straight to the DLQ', async () => {
    const m = message('not json');
    await make().handle(m);
    expect(handler).not.toHaveBeenCalled();
    expect(rabbit.sendToQueue).toHaveBeenCalledWith(
      `${QUEUE}.dlq`,
      m.content,
      undefined,
    );
    expect(rabbit.ack).toHaveBeenCalledWith(m);
  });

  it('stop cancels first, then waits for work in progress', async () => {
    let finish!: () => void;
    handler.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const consumer = make();
    await consumer.start();
    expect(rabbit.consume).toHaveBeenCalledWith(QUEUE, expect.any(Function), 5);
    const onMessage = rabbit.consume.mock.calls[0][1] as (
      m: RabbitMessage,
    ) => Promise<void>;
    void onMessage(message(JSON.stringify(envelope)));

    let stopped = false;
    const stopping = consumer.stop().then(() => (stopped = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rabbit.cancel).toHaveBeenCalledWith('tag-1');
    expect(stopped).toBe(false);
    finish();
    await stopping;
    expect(stopped).toBe(true);
    expect(rabbit.ack).toHaveBeenCalled();
  });
});
