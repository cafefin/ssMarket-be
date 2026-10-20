import type {
  OrderEventPayload,
  OrderEventType,
} from '../../events/domain-events.js';
import { notificationTargets } from './notification-rules.js';

const payload = (overrides: Partial<OrderEventPayload> = {}) =>
  ({
    orderId: 'o',
    orderCode: 'SS-1',
    buyerId: 'b',
    buyerName: 'Buyer',
    sellerId: 's',
    sellerName: 'Seller',
    title: 'Loa',
    total: 1000,
    actor: 'buyer',
    reason: null,
    ...overrides,
  }) satisfies OrderEventPayload;

describe('notificationTargets', () => {
  it.each<OrderEventType>([
    'order.placed',
    'order.edited',
    'order.payment_reported',
  ])('%s goes to the seller', (type) => {
    const targets = notificationTargets(type, payload());
    expect(targets).toEqual([
      expect.objectContaining({ recipientId: 's', role: 'seller' }),
    ]);
    expect(targets).toHaveLength(1);
  });

  it.each<OrderEventType>([
    'order.payment_confirmed',
    'order.payment_rejected',
    'order.delivered',
  ])('%s goes to the buyer', (type) => {
    const targets = notificationTargets(type, payload({ actor: 'seller' }));
    expect(targets).toEqual([
      expect.objectContaining({ recipientId: 'b', role: 'buyer' }),
    ]);
    expect(targets).toHaveLength(1);
  });

  it('order.cancelled by the buyer goes to the seller', () => {
    expect(
      notificationTargets('order.cancelled', payload({ actor: 'buyer' })),
    ).toEqual([expect.objectContaining({ recipientId: 's', role: 'seller' })]);
  });

  it('order.cancelled by the seller goes to the buyer', () => {
    expect(
      notificationTargets('order.cancelled', payload({ actor: 'seller' })),
    ).toEqual([expect.objectContaining({ recipientId: 'b', role: 'buyer' })]);
  });

  it('params are the payload plus the role', () => {
    const data = payload();
    expect(notificationTargets('order.placed', data)[0].params).toEqual({
      ...data,
      role: 'seller',
    });
  });

  it('drops a target equal to the actor', () => {
    expect(
      notificationTargets(
        'order.placed',
        payload({ buyerId: 'x', sellerId: 'x', actor: 'buyer' }),
      ),
    ).toEqual([]);
  });
});
