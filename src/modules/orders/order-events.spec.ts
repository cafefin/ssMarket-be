import type {
  DomainEvent,
  OrderEventPayload,
} from '../../events/domain-events.js';
import { orderEvent, type OrderEventSource } from './order-events.js';
import { OrderActor } from './orders.constants.js';

const source = (
  overrides: Partial<OrderEventSource> = {},
): OrderEventSource => ({
  id: 'o-1',
  code: 'SS-1',
  buyerId: 'b',
  sellerId: 's',
  totalAmount: 42000,
  buyer: { name: 'Buyer' },
  seller: { name: 'Seller' },
  campaign: null,
  lines: [],
  ...overrides,
});

const payloadOf = (event: DomainEvent) => event.payload as OrderEventPayload;

describe('orderEvent', () => {
  it('uses the round title for a pre-order', () => {
    const event = orderEvent(
      'order.placed',
      source({
        campaign: { title: 'Bánh trung thu' },
        lines: [{ title: 'X', sortOrder: 0 }],
      }),
      OrderActor.Buyer,
    );
    expect(payloadOf(event).title).toBe('Bánh trung thu');
  });

  it('uses the first line by sort order for in-stock goods', () => {
    const event = orderEvent(
      'order.placed',
      source({
        lines: [
          { title: 'B', sortOrder: 1 },
          { title: 'A', sortOrder: 0 },
        ],
      }),
      OrderActor.Buyer,
    );
    expect(payloadOf(event).title).toBe('A');
  });

  it('has an empty title without lines and campaign', () => {
    expect(
      payloadOf(orderEvent('order.placed', source(), OrderActor.Buyer)).title,
    ).toBe('');
  });

  it('carries ids, names, total, actor and a null reason by default', () => {
    const event = orderEvent('order.delivered', source(), OrderActor.Seller);
    expect(event).toEqual({
      type: 'order.delivered',
      payload: {
        orderId: 'o-1',
        orderCode: 'SS-1',
        buyerId: 'b',
        buyerName: 'Buyer',
        sellerId: 's',
        sellerName: 'Seller',
        title: '',
        total: 42000,
        actor: 'seller',
        reason: null,
      },
    });
  });

  it('passes the reason through', () => {
    const event = orderEvent(
      'order.cancelled',
      source(),
      OrderActor.Seller,
      'Hết hàng',
    );
    expect(payloadOf(event).reason).toBe('Hết hàng');
  });
});
