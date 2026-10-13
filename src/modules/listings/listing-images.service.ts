import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(ListingImagesService.name);

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
   * Deletes stored images and their thumbnails by storage key, for images
   * whose rows are already gone (a deleted product or round). Call it after
   * the delete has committed. It never throws: a file that cannot be removed
   * is logged and left behind, because the request it belongs to succeeded.
   */
  async removeFiles(storageKeys: readonly string[]): Promise<void> {
    for (const storageKey of storageKeys) {
      for (const key of [storageKey, thumbnailKey(storageKey)]) {
        try {
          await this.storage.delete(key);
        } catch (error) {
          this.logger.warn(
            `Could not delete the stored file ${key}: ${String(error)}`,
          );
        }
      }
    }
  }

  /**
   * Gives a listing its own copies of another listing's images. The files
   * are duplicated, not shared, so removing an image from one listing can
   * never break the other.
   *
   * When a copy fails, the error surfaces and the files of the image being
   * copied are removed; the images copied before it keep their rows and
   * files, which the caller removes with the listing.
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
      try {
        await this.storage.put(storageKey, full.data);
        await this.storage.put(thumbnailKey(storageKey), thumbnail.data);
        await this.images.create({
          listingId: targetListingId,
          storageKey,
          sortOrder: image.sortOrder,
        });
      } catch (error) {
        // Do not leave files that no database row points to.
        await this.removeFiles([storageKey]);
        throw error;
      }
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
    // A product of a round stays editable while it is not on sale; it is the
    // round that ends.
    const closed = listing.campaign
      ? listing.campaign.status === 'closed'
      : listing.status === ListingStatus.Closed;
    if (closed) {
      throw new DomainException(
        409,
        'INVALID_LISTING_STATE',
        'A closed listing cannot be edited',
      );
    }
  }
}
