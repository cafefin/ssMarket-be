import type { CampaignEventPayload } from '../../events/domain-events.js';
import { ListingStatus } from '../listings/listings.constants.js';
import type { Campaign } from './campaign.entity.js';
import { campaignPublishedEvent } from './campaign-events.js';

const campaign = (overrides: Partial<Campaign> = {}): Campaign =>
  ({
    id: 'c-1',
    sellerId: 's-1',
    seller: { name: 'Seller' },
    category: { name: 'Đồ ăn', nameEn: 'Food' },
    title: 'Bánh bao',
    orderDeadline: new Date('2026-10-15T10:00:00Z'),
    deliveryDate: '2026-10-17',
    reopenedFromId: null,
    items: [
      { status: ListingStatus.Draft },
      { status: ListingStatus.Draft },
      { status: ListingStatus.Closed },
    ],
    ...overrides,
  }) as unknown as Campaign;

describe('campaignPublishedEvent', () => {
  it('is campaign.opened for a new round', () => {
    expect(campaignPublishedEvent(campaign()).type).toBe('campaign.opened');
  });

  it('is campaign.reopened for a round made by reopen', () => {
    const event = campaignPublishedEvent(campaign({ reopenedFromId: 'c-0' }));
    expect(event.type).toBe('campaign.reopened');
  });

  it('describes the round and counts only the products it opens', () => {
    const payload = campaignPublishedEvent(campaign())
      .payload as CampaignEventPayload;
    expect(payload).toEqual({
      campaignId: 'c-1',
      sellerId: 's-1',
      sellerName: 'Seller',
      campaignTitle: 'Bánh bao',
      categoryName: 'Đồ ăn',
      orderDeadline: '2026-10-15T10:00:00.000Z',
      deliveryDate: '2026-10-17',
      itemCount: 2,
    });
  });
});
