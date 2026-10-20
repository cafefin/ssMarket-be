import type { DomainEvent } from '../../events/domain-events.js';
import { ListingStatus } from '../listings/listings.constants.js';
import type { Campaign } from './campaign.entity.js';

/** `campaign` has seller, category and items loaded (CampaignsRepository.findById). */
export function campaignPublishedEvent(campaign: Campaign): DomainEvent {
  return {
    type: campaign.reopenedFromId ? 'campaign.reopened' : 'campaign.opened',
    payload: {
      campaignId: campaign.id,
      sellerId: campaign.sellerId,
      sellerName: campaign.seller.name,
      campaignTitle: campaign.title,
      categoryName: campaign.category.name,
      orderDeadline: campaign.orderDeadline.toISOString(),
      deliveryDate: campaign.deliveryDate,
      itemCount: campaign.items.filter(
        (item) => item.status === ListingStatus.Draft,
      ).length,
    },
  };
}
