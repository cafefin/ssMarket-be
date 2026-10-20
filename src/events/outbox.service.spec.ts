import type { Tx } from '../database/transaction.js';
import {
  type DomainEvent,
  isChatEvent,
  isOrderEvent,
  parseEnvelope,
} from './domain-events.js';
import type { OutboxRepository } from './outbox.repository.js';
import { OutboxService } from './outbox.service.js';

const orderEvent: DomainEvent = {
  type: 'order.placed',
  payload: {
    orderId: 'o1',
    orderCode: 'SS-1',
    buyerId: 'b1',
    buyerName: 'Buyer',
    sellerId: 's1',
    sellerName: 'Seller',
    title: 'Item',
    total: 1000,
    actor: 'buyer',
    reason: null,
  },
};

describe('OutboxService', () => {
  it('writes the event in the given transaction and returns its envelope', async () => {
    const repo = { insert: vi.fn().mockResolvedValue(undefined) };
    const service = new OutboxService(repo as unknown as OutboxRepository);
    const tx = {} as Tx;
    const now = new Date('2026-05-01T10:00:00.000Z');

    const envelope = await service.add(tx, orderEvent, now);

    expect(envelope.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(envelope.version).toBe(1);
    expect(envelope.occurredAt).toBe(now.toISOString());
    expect(envelope.type).toBe('order.placed');
    expect(envelope.payload).toBe(orderEvent.payload);
    expect(repo.insert).toHaveBeenCalledWith(tx, {
      id: envelope.id,
      type: 'order.placed',
      payload: orderEvent.payload,
      occurredAt: now,
    });
    expect(repo.insert.mock.calls[0]![0]).toBe(tx);
  });
});

describe('parseEnvelope', () => {
  const valid = {
    id: 'e1',
    version: 1,
    occurredAt: '2026-05-01T10:00:00.000Z',
    ...orderEvent,
  };

  it('round trips a valid envelope', () => {
    expect(parseEnvelope(JSON.stringify(valid))).toEqual(valid);
  });

  it.each([
    ['non-JSON', 'nope'],
    ['version 2', JSON.stringify({ ...valid, version: 2 })],
    ['an unknown type', JSON.stringify({ ...valid, type: 'order.exploded' })],
    ['a missing payload', JSON.stringify({ ...valid, payload: undefined })],
    ['a missing id', JSON.stringify({ ...valid, id: undefined })],
  ])('returns null for %s', (_name, raw) => {
    expect(parseEnvelope(raw)).toBeNull();
  });
});

describe('event guards', () => {
  const chat: DomainEvent = {
    type: 'listing.published',
    payload: {
      listingId: 'l1',
      sellerId: 's1',
      sellerName: 'S',
      listingTitle: 'T',
      categoryName: 'C',
      unitPrice: 1,
    },
  };

  it('tells order events from chat events', () => {
    expect(isOrderEvent(orderEvent)).toBe(true);
    expect(isOrderEvent(chat)).toBe(false);
    expect(isChatEvent(chat)).toBe(true);
    expect(isChatEvent(orderEvent)).toBe(false);
  });
});
