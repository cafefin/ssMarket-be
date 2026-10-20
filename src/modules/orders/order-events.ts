import type {
  DomainEvent,
  OrderEventType,
} from '../../events/domain-events.js';
import type { OrderActor } from './orders.constants.js';

/** The parts of an order (with buyer, seller, campaign and lines loaded) an event needs. */
export interface OrderEventSource {
  id: string;
  code: string;
  buyerId: string;
  sellerId: string;
  totalAmount: number;
  buyer: { name: string };
  seller: { name: string };
  campaign: { title: string } | null;
  lines: { title: string; sortOrder: number }[];
}

export function orderEvent(
  type: OrderEventType,
  order: OrderEventSource,
  actor: OrderActor,
  reason: string | null = null,
): DomainEvent {
  const first = [...order.lines].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return {
    type,
    payload: {
      orderId: order.id,
      orderCode: order.code,
      buyerId: order.buyerId,
      buyerName: order.buyer.name,
      sellerId: order.sellerId,
      sellerName: order.seller.name,
      title: order.campaign?.title ?? first?.title ?? '',
      total: order.totalAmount,
      actor,
      reason,
    },
  };
}
