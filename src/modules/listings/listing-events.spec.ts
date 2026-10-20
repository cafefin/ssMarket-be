import type { ListingPublishedPayload } from '../../events/domain-events.js';
import type { Listing } from './listing.entity.js';
import { listingPublishedEvent } from './listing-events.js';

describe('listingPublishedEvent', () => {
  it('is listing.published with the product details', () => {
    const event = listingPublishedEvent({
      id: 'l-1',
      sellerId: 's-1',
      seller: { name: 'Seller' },
      category: { name: 'Đồ điện tử' },
      title: 'Loa JBL',
      unitPrice: 500_000,
    } as unknown as Listing);

    expect(event.type).toBe('listing.published');
    expect(event.payload as ListingPublishedPayload).toEqual({
      listingId: 'l-1',
      sellerId: 's-1',
      sellerName: 'Seller',
      listingTitle: 'Loa JBL',
      categoryName: 'Đồ điện tử',
      unitPrice: 500_000,
    });
  });
});
