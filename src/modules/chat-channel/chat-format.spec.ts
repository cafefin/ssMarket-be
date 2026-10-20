import {
  chatVariables,
  formatDeadline,
  formatDeliveryDate,
  formatPrice,
  sellerOf,
  startOfVietnamHour,
  vietnamHourKey,
} from './chat-format.js';
import type { EventEnvelope } from '../../events/domain-events.js';

describe('Vietnam time', () => {
  it('builds the hour key', () => {
    expect(vietnamHourKey(new Date('2026-10-15T16:59:59Z'))).toBe('2026101523');
    expect(vietnamHourKey(new Date('2026-10-15T17:00:00Z'))).toBe('2026101600');
  });

  it('finds the start of the hour', () => {
    expect(
      startOfVietnamHour(new Date('2026-10-15T16:59:59Z')).toISOString(),
    ).toBe('2026-10-15T16:00:00.000Z');
  });

  it('formats dates', () => {
    expect(formatDeadline('2026-10-20T10:00:00.000Z')).toBe('17:00 20/10');
    expect(formatDeliveryDate('2026-10-22')).toBe('22/10');
  });
});

describe('formatPrice', () => {
  it('groups thousands without ICU', () => {
    expect(formatPrice(120000)).toBe('120.000 ₫');
    expect(formatPrice(1000)).toBe('1.000 ₫');
    expect(formatPrice(15)).toBe('15 ₫');
  });
});

const campaign = {
  id: 'e1',
  version: 1,
  occurredAt: '2026-10-20T00:00:00.000Z',
  type: 'campaign.opened',
  payload: {
    campaignId: 'c1',
    sellerId: 's1',
    sellerName: 'An',
    campaignTitle: 'Bánh',
    categoryName: 'Đồ ăn',
    orderDeadline: '2026-10-20T10:00:00.000Z',
    deliveryDate: '2026-10-22',
    itemCount: 3,
  },
} as const satisfies EventEnvelope;

const listing = {
  id: 'e2',
  version: 1,
  occurredAt: '2026-10-20T00:00:00.000Z',
  type: 'listing.published',
  payload: {
    listingId: 'l1',
    sellerId: 's2',
    sellerName: 'Bình',
    listingTitle: 'Bàn phím',
    categoryName: 'Điện tử',
    unitPrice: 120000,
  },
} as const satisfies EventEnvelope;

describe('chatVariables', () => {
  it('maps a campaign event', () => {
    expect(chatVariables(campaign, 'http://localhost:3000')).toEqual({
      sellerName: 'An',
      campaignTitle: 'Bánh',
      categoryName: 'Đồ ăn',
      deadline: '17:00 20/10',
      deliveryDate: '22/10',
      itemCount: '3',
      url: 'http://localhost:3000/campaigns/c1',
    });
  });

  it('maps a listing event', () => {
    expect(chatVariables(listing, 'http://localhost:3000')).toEqual({
      sellerName: 'Bình',
      listingTitle: 'Bàn phím',
      categoryName: 'Điện tử',
      price: '120.000 ₫',
      url: 'http://localhost:3000/listings/l1',
    });
  });

  it('names the seller', () => {
    expect(sellerOf(campaign)).toBe('s1');
    expect(sellerOf(listing)).toBe('s2');
  });
});
