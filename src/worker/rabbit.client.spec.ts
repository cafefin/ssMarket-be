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
});
