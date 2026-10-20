export const ORDER_EVENT_TYPES = [
  'order.placed',
  'order.edited',
  'order.payment_reported',
  'order.payment_confirmed',
  'order.payment_rejected',
  'order.delivered',
  'order.cancelled',
] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export const CHAT_EVENT_TYPES = [
  'campaign.opened',
  'campaign.reopened',
  'listing.published',
] as const;
export type ChatEventType = (typeof CHAT_EVENT_TYPES)[number];

export interface OrderEventPayload {
  orderId: string;
  orderCode: string;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  sellerName: string;
  /** The round's title, or the first product's title for an in-stock order. */
  title: string;
  /** Integer VND. */
  total: number;
  actor: 'buyer' | 'seller';
  /** Set on order.cancelled when the canceller gave one. */
  reason: string | null;
}

export interface CampaignEventPayload {
  campaignId: string;
  sellerId: string;
  sellerName: string;
  campaignTitle: string;
  /** Vietnamese category name. */
  categoryName: string;
  /** ISO instant. */
  orderDeadline: string;
  /** YYYY-MM-DD. */
  deliveryDate: string;
  itemCount: number;
}

export interface ListingPublishedPayload {
  listingId: string;
  sellerId: string;
  sellerName: string;
  listingTitle: string;
  categoryName: string;
  /** Integer VND. */
  unitPrice: number;
}

export type DomainEvent =
  | { type: OrderEventType; payload: OrderEventPayload }
  | {
      type: 'campaign.opened' | 'campaign.reopened';
      payload: CampaignEventPayload;
    }
  | { type: 'listing.published'; payload: ListingPublishedPayload };

/** What travels on the bus; `type` is also the routing key. */
export type EventEnvelope = DomainEvent & {
  id: string;
  version: 1;
  occurredAt: string;
};

export function isOrderEvent(
  event: DomainEvent,
): event is Extract<DomainEvent, { type: OrderEventType }> {
  return (ORDER_EVENT_TYPES as readonly string[]).includes(event.type);
}

export function isChatEvent(
  event: DomainEvent,
): event is Extract<DomainEvent, { type: ChatEventType }> {
  return (CHAT_EVENT_TYPES as readonly string[]).includes(event.type);
}

/** Parses a message body; null when it is not a version-1 envelope of a known type. */
export function parseEnvelope(raw: string): EventEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const known =
    typeof candidate.type === 'string' &&
    ([...ORDER_EVENT_TYPES, ...CHAT_EVENT_TYPES] as string[]).includes(
      candidate.type,
    );
  if (
    candidate.version !== 1 ||
    !known ||
    typeof candidate.id !== 'string' ||
    typeof candidate.occurredAt !== 'string' ||
    typeof candidate.payload !== 'object' ||
    candidate.payload === null
  ) {
    return null;
  }
  return candidate as unknown as EventEnvelope;
}
