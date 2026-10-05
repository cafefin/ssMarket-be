import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CacheService } from '../../cache/cache.service.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { CategoriesService } from '../categories/categories.service.js';
import { UsersService } from '../users/users.service.js';
import {
  isListingOpen,
  type ListingInput,
  validateListingInput,
} from './listing-rules.js';
import type { Listing } from './listing.entity.js';
import {
  LISTINGS_CACHE_NAMESPACE,
  ListingMode,
  ListingStatus,
} from './listings.constants.js';
import {
  type ListingItemFields,
  ListingsRepository,
} from './listings.repository.js';
import { buildSearchText } from './search-text.js';

@Injectable()
export class ListingsService {
  constructor(
    private readonly listings: ListingsRepository,
    private readonly users: UsersService,
    private readonly categories: CategoriesService,
    private readonly cache: CacheService,
  ) {}

  async create(sellerId: string, input: ListingInput): Promise<Listing> {
    await this.assertValid(sellerId, input);

    const id = await this.listings.insert(
      {
        sellerId,
        mode: input.mode,
        status: ListingStatus.Draft,
        publishedAt: null,
        closedAt: null,
        ...this.editableFields(input),
      },
      this.itemFields(input),
    );

    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
    return this.mustFind(id);
  }

  async update(
    sellerId: string,
    id: string,
    input: ListingInput,
  ): Promise<Listing> {
    const listing = await this.findOwned(sellerId, id);
    if (listing.status === ListingStatus.Closed) {
      throw this.invalidState('A closed listing cannot be edited');
    }
    if (input.mode !== listing.mode) {
      throw new BadRequestException('The mode of a listing cannot be changed');
    }
    await this.assertValid(sellerId, input);

    await this.listings.update(
      id,
      this.editableFields(input),
      this.itemFields(input),
    );

    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
    return this.mustFind(id);
  }

  async publish(sellerId: string, id: string): Promise<Listing> {
    const listing = await this.findOwned(sellerId, id);
    if (listing.status !== ListingStatus.Draft) {
      throw this.invalidState('Only a draft can be published');
    }

    const now = new Date();
    if (
      listing.mode === ListingMode.Preorder &&
      (listing.orderDeadline === null ||
        listing.orderDeadline.getTime() <= now.getTime())
    ) {
      throw new BadRequestException('The order deadline must be in the future');
    }
    if (listing.acceptsPrepaidQr) {
      await this.assertBankProfile(sellerId);
    }

    await this.listings.update(id, {
      status: ListingStatus.Open,
      publishedAt: now,
    });

    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
    return this.mustFind(id);
  }

  async close(sellerId: string, id: string): Promise<Listing> {
    const listing = await this.findOwned(sellerId, id);
    if (listing.status !== ListingStatus.Open) {
      throw this.invalidState('Only an open listing can be closed');
    }

    await this.listings.update(id, {
      status: ListingStatus.Closed,
      closedAt: new Date(),
    });

    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
    return this.mustFind(id);
  }

  /**
   * The seller sees their listing in any state. Everyone else sees it only
   * while it is open; otherwise it does not exist as far as they can tell.
   */
  async getForViewer(viewerId: string, id: string): Promise<Listing> {
    const listing = await this.mustFind(id);
    if (listing.sellerId !== viewerId && !isListingOpen(listing, new Date())) {
      throw new NotFoundException('Listing not found');
    }
    return listing;
  }

  listMine(sellerId: string, status?: ListingStatus): Promise<Listing[]> {
    return this.listings.findBySeller(sellerId, status);
  }

  private async mustFind(id: string): Promise<Listing> {
    const listing = await this.listings.findByIdWithRelations(id);
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    return listing;
  }

  private async findOwned(sellerId: string, id: string): Promise<Listing> {
    const listing = await this.mustFind(id);
    if (listing.sellerId !== sellerId) {
      throw new ForbiddenException('You can only change your own listings');
    }
    return listing;
  }

  private async assertValid(
    sellerId: string,
    input: ListingInput,
  ): Promise<void> {
    const problems = validateListingInput(input);
    if (problems.length > 0) {
      throw new BadRequestException(problems.join('; '));
    }
    if (!(await this.categories.findById(input.categoryId))) {
      throw new BadRequestException('Unknown category');
    }
    if (input.acceptsPrepaidQr) {
      await this.assertBankProfile(sellerId);
    }
  }

  private async assertBankProfile(sellerId: string): Promise<void> {
    const seller = await this.users.getById(sellerId);
    if (!this.users.hasBankProfile(seller)) {
      throw new DomainException(
        422,
        'BANK_PROFILE_REQUIRED',
        'Add your bank details before accepting QR payments',
      );
    }
  }

  private invalidState(message: string): DomainException {
    return new DomainException(409, 'INVALID_LISTING_STATE', message);
  }

  private editableFields(input: ListingInput) {
    return {
      categoryId: input.categoryId,
      title: input.title.trim(),
      description: input.description,
      acceptsPrepaidQr: input.acceptsPrepaidQr,
      acceptsPayOnDelivery: input.acceptsPayOnDelivery,
      orderDeadline: input.orderDeadline,
      deliveryDate: input.deliveryDate,
      searchText: buildSearchText(input),
    };
  }

  private itemFields(input: ListingInput): ListingItemFields[] {
    return input.items.map((item, index) => ({
      name: item.name.trim(),
      unit: item.unit,
      unitPrice: item.unitPrice,
      stockQuantity: item.stockQuantity,
      sortOrder: index,
    }));
  }
}
