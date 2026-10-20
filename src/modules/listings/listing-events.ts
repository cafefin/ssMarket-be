import type { DomainEvent } from '../../events/domain-events.js';
import type { Listing } from './listing.entity.js';

/** `listing` has seller and category loaded. */
export function listingPublishedEvent(listing: Listing): DomainEvent {
  return {
    type: 'listing.published',
    payload: {
      listingId: listing.id,
      sellerId: listing.sellerId,
      sellerName: listing.seller.name,
      listingTitle: listing.title,
      categoryName: listing.category.name,
      unitPrice: listing.unitPrice,
    },
  };
}
