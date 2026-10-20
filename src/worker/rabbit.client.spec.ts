import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { OutboxRepository } from '../events/outbox.repository.js';
import { OutboxRelay } from './outbox-relay.js';
import { RabbitClient, type RabbitMessage } from './rabbit.client.js';

const mocks = vi.hoisted(() => {
  const handlers: Record<string, (arg: unknown) => void> = {};
  const channel = {
    on: vi.fn((event: string, fn: (arg: unknown) => void) => {
      handlers[`channel:${event}`] = fn;
    }),
    consume: vi.fn(),
    nack: vi.fn(),
    ack: vi.fn(),
    sendToQueue: vi.fn().mockResolvedValue(true),
  };
  const connection = {
    on: vi.fn(),
    createChannel: vi.fn(() => channel),
  };
  return { handlers, channel, connection };
});

vi.mock('amqp-connection-manager', () => ({
  connect: vi.fn(() => mocks.connection),
}));

const config = {
  get: vi.fn().mockReturnValue('amqp://localhost'),
} as unknown as ConfigService;

describe('RabbitClient', () => {
  let client: RabbitClient;
  let logError: ReturnType<typeof vi.spyOn>;
  let logWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new RabbitClient(config as never);
    logError = vi
      .spyOn(client['logger'], 'error')
      .mockImplementation(() => undefined);
    logWarn = vi
      .spyOn(client['logger'], 'warn')
      .mockImplementation(() => undefined);
  });

  it('is resolved by Nest together with OutboxRelay', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RabbitClient,
        OutboxRelay,
        { provide: OutboxRepository, useValue: {} },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    expect(moduleRef.get(RabbitClient)).toBeInstanceOf(RabbitClient);
    expect(moduleRef.get(OutboxRelay)).toBeInstanceOf(OutboxRelay);
  });

  it('logs channel errors instead of throwing', () => {
    // The listener registered by the constructor under test.
    const calls = mocks.channel.on.mock.calls as [string, unknown][];
    expect(calls.map(([event]) => event)).toContain('error');
    const listener = mocks.handlers['channel:error'] as (e: Error) => void;
    const logSpy = vi.spyOn(client['logger'], 'error');

    expect(() => listener(new Error('PRECONDITION_FAILED'))).not.toThrow();
    expect(logSpy.mock.calls.length + logWarn.mock.calls.length).toBe(1);
    const text = String(
      (logSpy.mock.calls[0] ?? logWarn.mock.calls[0])?.[0],
    );
    expect(text).toContain('PRECONDITION_FAILED');
  });

  it('rejects and logs a message whose handler throws', async () => {
    let deliver!: (raw: unknown) => void;
    mocks.channel.consume.mockImplementation(
      (_q: string, cb: (raw: unknown) => void) => {
        deliver = cb;
        return Promise.resolve({ consumerTag: 't' });
      },
    );
    const raw = { content: Buffer.from('x'), properties: { headers: {} } };
    const onMessage = vi
      .fn<(m: RabbitMessage) => Promise<void>>()
      .mockRejectedValue(new Error('boom'));

    await client.consume('notify.q', onMessage, 5);
    deliver(raw);
    await vi.waitFor(() => expect(mocks.channel.nack).toHaveBeenCalled());

    expect(mocks.channel.nack).toHaveBeenCalledWith(raw, false, false);
    expect(logError).toHaveBeenCalledTimes(1);
    const text = String(logError.mock.calls[0]?.[0]);
    expect(text).toContain('notify.q');
    expect(text).toContain('boom');
  });

  const topologyChannel = () => ({
    assertExchange: vi.fn().mockResolvedValue({}),
    assertQueue: vi.fn().mockResolvedValue({}),
    bindQueue: vi.fn().mockResolvedValue({}),
  });

  /** Runs the channel setup, as amqp-connection-manager does on every new channel. */
  const newChannel = async (): Promise<void> => {
    const options = (
      mocks.connection.createChannel.mock.calls.at(-1) as unknown as [
        { setup: (c: unknown) => Promise<void> },
      ]
    )[0];
    await options.setup(topologyChannel());
  };

  const captureDelivery = () => {
    const box: { deliver?: (raw: unknown) => void } = {};
    mocks.channel.consume.mockImplementation(
      (_q: string, cb: (raw: unknown) => void) => {
        box.deliver = cb;
        return Promise.resolve({ consumerTag: 't' });
      },
    );
    return box;
  };

  const rawMessage = () => ({
    content: Buffer.from('x'),
    properties: {
      headers: { h: 1 },
      messageId: 'm-1',
      type: 'order.placed',
      contentType: 'application/json',
    },
  });

  it('stamps each delivery with its properties and channel generation', async () => {
    await newChannel();
    const box = captureDelivery();
    const received: RabbitMessage[] = [];
    await client.consume('q', async (m) => {
      received.push(m);
    }, 5);
    const raw = rawMessage();
    box.deliver!(raw);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      content: raw.content,
      headers: { h: 1 },
      messageId: 'm-1',
      type: 'order.placed',
      contentType: 'application/json',
      raw,
    });
    expect(typeof received[0]?.generation).toBe('number');
  });

  it('ignores ack and reject for a message from a channel that was replaced', async () => {
    await newChannel();
    const box = captureDelivery();
    const received: RabbitMessage[] = [];
    await client.consume('q', async (m) => {
      received.push(m);
    }, 5);
    box.deliver!(rawMessage());
    await vi.waitFor(() => expect(received).toHaveLength(1));
    const message = received[0]!;

    await newChannel(); // reconnect: a new channel, new delivery tags
    client.ack(message);
    client.reject(message);

    expect(mocks.channel.ack).not.toHaveBeenCalled();
    expect(mocks.channel.nack).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledTimes(2);
  });

  it('ignores ack after the channel wrapper closed', async () => {
    await newChannel();
    const message = {
      content: Buffer.from('x'),
      headers: undefined,
      generation: 0,
      raw: {},
    } as unknown as RabbitMessage;
    const box = captureDelivery();
    const received: RabbitMessage[] = [];
    await client.consume('q', async (m) => {
      received.push(m);
    }, 5);
    box.deliver!(rawMessage());
    await vi.waitFor(() => expect(received).toHaveLength(1));

    mocks.handlers['channel:close']?.(undefined);
    client.ack(received[0]!);
    client.ack(message);
    expect(mocks.channel.ack).not.toHaveBeenCalled();
  });

  it('acks and rejects on the channel that delivered the message', async () => {
    await newChannel();
    const box = captureDelivery();
    const received: RabbitMessage[] = [];
    await client.consume('q', async (m) => {
      received.push(m);
    }, 5);
    const raw = rawMessage();
    box.deliver!(raw);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    client.ack(received[0]!);
    client.reject(received[0]!);
    expect(mocks.channel.ack).toHaveBeenCalledWith(raw);
    expect(mocks.channel.nack).toHaveBeenCalledWith(raw, false, false);
  });

  it('logs an ack that throws and does not reject the message', async () => {
    await newChannel();
    mocks.channel.ack.mockImplementationOnce(() => {
      throw new Error('IllegalOperationError: channel closed');
    });
    const box = captureDelivery();
    await client.consume('q', async (m) => client.ack(m), 5);
    box.deliver!(rawMessage());
    await vi.waitFor(() => expect(logError).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(String(logError.mock.calls[0]?.[0])).toContain('channel closed');
    expect(mocks.channel.nack).not.toHaveBeenCalled();
  });

  it('logs a nack that throws instead of throwing', async () => {
    await newChannel();
    mocks.channel.nack.mockImplementationOnce(() => {
      throw new Error('nack broke');
    });
    const box = captureDelivery();
    await client.consume('q', () => Promise.reject(new Error('boom')), 5);
    box.deliver!(rawMessage());
    await vi.waitFor(() => expect(logError).toHaveBeenCalledTimes(2));
    expect(String(logError.mock.calls[1]?.[0])).toContain('nack broke');
  });

  it('catches a handler that throws synchronously and nacks the message', async () => {
    await newChannel();
    const box = captureDelivery();
    const onMessage = vi.fn((): Promise<void> => {
      throw new Error('sync boom');
    });
    await client.consume('q', onMessage, 5);
    const raw = rawMessage();
    expect(() => box.deliver!(raw)).not.toThrow();
    await vi.waitFor(() =>
      expect(mocks.channel.nack).toHaveBeenCalledWith(raw, false, false),
    );
    expect(String(logError.mock.calls[0]?.[0])).toContain('sync boom');
  });

  it('sends to a queue with the original message properties', async () => {
    await client.sendToQueue('q.dlq', Buffer.from('x'), {
      headers: { h: 1 },
      messageId: 'm-1',
      type: 'order.placed',
      contentType: 'application/json',
    });
    expect(mocks.channel.sendToQueue).toHaveBeenCalledWith(
      'q.dlq',
      Buffer.from('x'),
      {
        persistent: true,
        headers: { h: 1 },
        messageId: 'm-1',
        type: 'order.placed',
        contentType: 'application/json',
      },
    );
  });
});
