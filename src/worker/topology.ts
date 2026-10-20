import type { ConfirmChannel } from 'amqplib';

export const EVENTS_EXCHANGE = 'ssmarket.events';
export const MAX_ATTEMPTS = 5;
export const RETRY_DELAY_MS = 30_000;

export interface QueueSpec {
  name: string;
  bindings: string[];
}

export const INAPP_QUEUE: QueueSpec = {
  name: 'notifications.inapp',
  bindings: ['order.*'],
};
export const GCHAT_QUEUE: QueueSpec = {
  name: 'notifications.gchat',
  bindings: ['campaign.*', 'listing.published'],
};
export const QUEUES: QueueSpec[] = [INAPP_QUEUE, GCHAT_QUEUE];

export const retryQueue = (queue: string): string => `${queue}.retry`;
export const deadLetterQueue = (queue: string): string => `${queue}.dlq`;

/** Declares the exchange and, per queue, main + retry + DLQ. Idempotent. */
export async function assertTopology(
  channel: Pick<ConfirmChannel, 'assertExchange' | 'assertQueue' | 'bindQueue'>,
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
  for (const queue of QUEUES) {
    await channel.assertQueue(queue.name, {
      durable: true,
      deadLetterExchange: '',
      deadLetterRoutingKey: retryQueue(queue.name),
    });
    await channel.assertQueue(retryQueue(queue.name), {
      durable: true,
      messageTtl: RETRY_DELAY_MS,
      deadLetterExchange: '',
      deadLetterRoutingKey: queue.name,
    });
    await channel.assertQueue(deadLetterQueue(queue.name), { durable: true });
    for (const key of queue.bindings) {
      await channel.bindQueue(queue.name, EVENTS_EXCHANGE, key);
    }
  }
}

/** How many times `queue` has already rejected this message (from x-death). */
export function failedAttempts(
  headers: Record<string, unknown> | undefined,
  queue: string,
): number {
  const deaths = Array.isArray(headers?.['x-death'])
    ? (headers['x-death'] as unknown[])
    : [];
  for (const death of deaths) {
    const entry = death as { queue?: unknown; reason?: unknown; count?: unknown };
    if (entry.queue === queue && entry.reason === 'rejected') {
      return Number(entry.count) || 0;
    }
  }
  return 0;
}

/** What to do after a handler failed on this delivery. */
export function afterFailure(previousFailures: number): 'retry' | 'dead-letter' {
  return previousFailures + 1 >= MAX_ATTEMPTS ? 'dead-letter' : 'retry';
}
