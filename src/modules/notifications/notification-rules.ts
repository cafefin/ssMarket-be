import type {
  OrderEventPayload,
  OrderEventType,
} from '../../events/domain-events.js';

export type NotificationRole = 'buyer' | 'seller';

export interface NotificationTarget {
  recipientId: string;
  role: NotificationRole;
  /** The payload plus `role`; what the frontend renders. */
  params: OrderEventPayload & { role: NotificationRole };
}

const TO_SELLER: OrderEventType[] = [
  'order.placed',
  'order.edited',
  'order.payment_reported',
];
const TO_BUYER: OrderEventType[] = [
  'order.payment_confirmed',
  'order.payment_rejected',
  'order.delivered',
];

/** Who hears about an order event. Never the person who caused it. */
export function notificationTargets(
  type: OrderEventType,
  payload: OrderEventPayload,
): NotificationTarget[] {
  let role: NotificationRole;
  if (TO_SELLER.includes(type)) role = 'seller';
  else if (TO_BUYER.includes(type)) role = 'buyer';
  else role = payload.actor === 'buyer' ? 'seller' : 'buyer'; // order.cancelled: the other side
  const recipientId = role === 'seller' ? payload.sellerId : payload.buyerId;
  const actorId = payload.actor === 'seller' ? payload.sellerId : payload.buyerId;
  if (recipientId === actorId) return [];
  return [{ recipientId, role, params: { ...payload, role } }];
}
