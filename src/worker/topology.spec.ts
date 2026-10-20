import {
  afterFailure,
  assertTopology,
  failedAttempts,
  GCHAT_QUEUE,
  INAPP_QUEUE,
} from './topology.js';

describe('assertTopology', () => {
  it('declares the exchange, then per queue main, retry, dead-letter and bindings', async () => {
    const calls: [string, ...unknown[]][] = [];
    const channel = {
      assertExchange: (...args: unknown[]) => {
        calls.push(['exchange', ...args]);
        return Promise.resolve({ exchange: '' });
      },
      assertQueue: (...args: unknown[]) => {
        calls.push(['queue', ...args]);
        return Promise.resolve({ queue: '', messageCount: 0, consumerCount: 0 });
      },
      bindQueue: (...args: unknown[]) => {
        calls.push(['bind', ...args]);
        return Promise.resolve({});
      },
    };

    await assertTopology(channel);

    expect(calls[0]).toEqual([
      'exchange',
      'ssmarket.events',
      'topic',
      { durable: true },
    ]);
    for (const queue of [INAPP_QUEUE, GCHAT_QUEUE]) {
      expect(calls).toContainEqual([
        'queue',
        queue.name,
        {
          durable: true,
          deadLetterExchange: '',
          deadLetterRoutingKey: `${queue.name}.retry`,
        },
      ]);
      expect(calls).toContainEqual([
        'queue',
        `${queue.name}.retry`,
        {
          durable: true,
          messageTtl: 30000,
          deadLetterExchange: '',
          deadLetterRoutingKey: queue.name,
        },
      ]);
      expect(calls).toContainEqual([
        'queue',
        `${queue.name}.dlq`,
        { durable: true },
      ]);
      for (const key of queue.bindings) {
        expect(calls).toContainEqual([
          'bind',
          queue.name,
          'ssmarket.events',
          key,
        ]);
      }
    }
    expect(calls.filter(([kind]) => kind === 'bind')).toHaveLength(3);
  });
});

describe('failedAttempts', () => {
  it('is 0 without headers', () => {
    expect(failedAttempts(undefined, 'notifications.inapp')).toBe(0);
  });

  it('reads the rejected count of the queue', () => {
    const headers = {
      'x-death': [
        { queue: 'notifications.inapp', reason: 'rejected', count: 3 },
        { queue: 'notifications.inapp.retry', reason: 'expired', count: 3 },
      ],
    };
    expect(failedAttempts(headers, 'notifications.inapp')).toBe(3);
  });

  it('ignores entries of another queue', () => {
    const headers = {
      'x-death': [{ queue: 'notifications.gchat', reason: 'rejected', count: 2 }],
    };
    expect(failedAttempts(headers, 'notifications.inapp')).toBe(0);
  });
});

describe('afterFailure', () => {
  it.each([0, 1, 2, 3])('retries after %i earlier failures', (n) => {
    expect(afterFailure(n)).toBe('retry');
  });

  it('dead-letters the fifth failed delivery', () => {
    expect(afterFailure(4)).toBe('dead-letter');
  });
});
