import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CacheService } from '../../cache/cache.service.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { StorageService } from '../storage/storage.service.js';
import { processListingImage } from './image-processor.js';
import type { ListingImage } from './listing-image.entity.js';
import { ListingImagesRepository } from './listing-images.repository.js';
import {
  LISTING_LIMITS,
  LISTINGS_CACHE_NAMESPACE,
  ListingStatus,
} from './listings.constants.js';
import { ListingsRepository } from './listings.repository.js';
import { thumbnailKey } from './media-url.js';

@Injectable()
export class ListingImagesService {
  constructor(
    private readonly listings: ListingsRepository,
    private readonly images: ListingImagesRepository,
    private readonly storage: StorageService,
    private readonly cache: CacheService,
  ) {}

  async add(
    sellerId: string,
    listingId: string,
    file: Buffer,
  ): Promise<ListingImage> {
    await this.assertEditable(sellerId, listingId);

    const existing = await this.images.findByListing(listingId);
    if (existing.length >= LISTING_LIMITS.imagesMax) {
      throw new DomainException(
        409,
        'TOO_MANY_IMAGES',
        `A listing can have at most ${LISTING_LIMITS.imagesMax} images`,
      );
    }

    const { full, thumbnail } = await processListingImage(file);
    const storageKey = `listings/${listingId}/${randomUUID()}.webp`;

    await this.storage.put(storageKey, full);
    try {
      await this.storage.put(thumbnailKey(storageKey), thumbnail);
    } catch (error) {
      // Do not leave a full-size file that no database row points to.
      await this.storage.delete(storageKey);
      throw error;
    }

    const image = await this.images.create({
      listingId,
      storageKey,
      sortOrder: (existing.at(-1)?.sortOrder ?? -1) + 1,
    });
    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
    return image;
  }

  async remove(
    sellerId: string,
    listingId: string,
    imageId: string,
  ): Promise<void> {
    await this.assertEditable(sellerId, listingId);

    const image = await this.images.findOne(listingId, imageId);
    if (!image) {
      throw new NotFoundException('Image not found');
    }

    await this.images.delete(image.id);
    await this.storage.delete(image.storageKey);
    await this.storage.delete(thumbnailKey(image.storageKey));
    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
  }

  /**
   * Gives a listing its own copies of another listing's images. The files
   * are duplicated, not shared, so removing an image from one listing can
   * never break the other.
   */
  async copyAll(
    source: ListingImage[],
    targetListingId: string,
  ): Promise<void> {
    for (const image of source) {
      const [full, thumbnail] = await Promise.all([
        this.storage.get(image.storageKey),
        this.storage.get(thumbnailKey(image.storageKey)),
      ]);
      if (!full || !thumbnail) {
        // The file is gone; leave this image out rather than fail the copy.
        continue;
      }
      const storageKey = `listings/${targetListingId}/${randomUUID()}.webp`;
      await this.storage.put(storageKey, full.data);
      await this.storage.put(thumbnailKey(storageKey), thumbnail.data);
      await this.images.create({
        listingId: targetListingId,
        storageKey,
        sortOrder: image.sortOrder,
      });
    }
  }

  private async assertEditable(
    sellerId: string,
    listingId: string,
  ): Promise<void> {
    const listing = await this.listings.findByIdWithRelations(listingId);
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    if (listing.sellerId !== sellerId) {
      throw new ForbiddenException('You can only change your own listings');
    }
    if (listing.status === ListingStatus.Closed) {
      throw new DomainException(
        409,
        'INVALID_LISTING_STATE',
        'A closed listing cannot be edited',
      );
    }
  }
}
