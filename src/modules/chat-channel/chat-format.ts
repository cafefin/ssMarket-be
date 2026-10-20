import type {
  ChatEventType,
  EventEnvelope,
} from '../../events/domain-events.js';

type ChatEvent = Extract<EventEnvelope, { type: ChatEventType }>;

/** Vietnam is UTC+7 all year. */
const VIETNAM_OFFSET_MS = 7 * 3_600_000;
const HOUR_MS = 3_600_000;

const pad = (n: number): string => String(n).padStart(2, '0');

function shifted(date: Date): Date {
  return new Date(date.getTime() + VIETNAM_OFFSET_MS);
}

/** "2026101509": the Vietnam clock hour of `now`. */
export function vietnamHourKey(now: Date): string {
  const v = shifted(now);
  return `${v.getUTCFullYear()}${pad(v.getUTCMonth() + 1)}${pad(v.getUTCDate())}${pad(v.getUTCHours())}`;
}

/** The instant the Vietnam clock hour of `now` started. */
export function startOfVietnamHour(now: Date): Date {
  const local = now.getTime() + VIETNAM_OFFSET_MS;
  return new Date(local - (local % HOUR_MS) - VIETNAM_OFFSET_MS);
}

/** "17:00 20/10" */
export function formatDeadline(iso: string): string {
  const v = shifted(new Date(iso));
  return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())} ${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}`;
}

/** "2026-10-22" becomes "22/10". */
export function formatDeliveryDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}

/** 120000 becomes "120.000 ₫". */
export function formatPrice(amount: number): string {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
}

/** Template values of a chat event; `webUrl` is WEB_URL without a trailing slash. */
export function chatVariables(
  event: ChatEvent,
  webUrl: string,
): Record<string, string> {
  switch (event.type) {
    case 'campaign.opened':
    case 'campaign.reopened': {
      const p = event.payload;
      return {
        sellerName: p.sellerName,
        campaignTitle: p.campaignTitle,
        categoryName: p.categoryName,
        deadline: formatDeadline(p.orderDeadline),
        deliveryDate: formatDeliveryDate(p.deliveryDate),
        itemCount: String(p.itemCount),
        url: `${webUrl}/campaigns/${p.campaignId}`,
      };
    }
    case 'listing.published': {
      const p = event.payload;
      return {
        sellerName: p.sellerName,
        listingTitle: p.listingTitle,
        categoryName: p.categoryName,
        price: formatPrice(p.unitPrice),
        url: `${webUrl}/listings/${p.listingId}`,
      };
    }
  }
}

export function sellerOf(event: ChatEvent): string {
  return event.payload.sellerId;
}
