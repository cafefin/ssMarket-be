import { createHash } from 'node:crypto';
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
import { ListingDetailDto } from './dto/listing-response.dto.js';
import type {
  ListingPageDto,
  ListingSummaryDto,
} from './dto/listing-summary.dto.js';
import {
  decodeCursor,
  encodeCursor,
  type ListingCursor,
} from './listing-cursor.js';
import {
  isListingOpen,
  type ListingInput,
  validateListingInput,
} from './listing-rules.js';
import type { Listing } from './listing.entity.js';
import {
  LISTINGS_CACHE_NAMESPACE,
  LISTINGS_CACHE_TTL_SECONDS,
  ListingMode,
  ListingStatus,
} from './listings.constants.js';
import {
  type ListingItemFields,
  ListingsRepository,
  type OpenListingRow,
} from './listings.repository.js';
import { mediaUrl, thumbnailKey } from './media-url.js';
import { toTsQuery } from './search-query.js';
import { buildSearchText } from './search-text.js';

export interface ListingSearchParams {
  q?: string;
  category?: string;
  mode?: ListingMode;
  cursor?: string;
  limit?: number;
}

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;

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

  /** Browse or search open listings. The result is cached for a minute. */
  async search(params: ListingSearchParams): Promise<ListingPageDto> {
    const limit = Math.min(
      Math.max(params.limit ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const tsQuery = params.q ? toTsQuery(params.q) : null;
    const cursor = params.cursor ? decodeCursor(params.cursor) : null;
    const expectedKind = tsQuery === null ? 'recent' : 'ranked';
    if (cursor && cursor.kind !== expectedKind) {
      throw new BadRequestException('Invalid cursor');
    }

    let categoryId: number | null = null;
    if (params.category) {
      const category = await this.categories.findBySlug(params.category);
      if (!category) {
        return { items: [], nextCursor: null };
      }
      categoryId = category.id;
    }
    const mode = params.mode ?? null;

    const fingerprint = createHash('sha256')
      .update(JSON.stringify([tsQuery, categoryId, mode, cursor, limit]))
      .digest('hex');
    const version = await this.cache.getVersion(LISTINGS_CACHE_NAMESPACE);

    return this.cache.getOrSet(
      `${LISTINGS_CACHE_NAMESPACE}:v${version}:list:${fingerprint}`,
      LISTINGS_CACHE_TTL_SECONDS,
      async () => {
        const rows = await this.listings.searchOpen({
          tsQuery,
          categoryId,
          mode,
          cursor,
          limit: limit + 1,
          now: new Date(),
        });
        const page = rows.slice(0, limit);
        return {
          items: page.map((row) => this.toSummary(row)),
          nextCursor:
            rows.length > limit
              ? encodeCursor(this.nextCursor(tsQuery, cursor, page))
              : null,
        };
      },
    );
  }

  /**
   * The detail view for anyone signed in. Open listings come from the cache;
   * anything else falls through to the seller-only path.
   */
  async getPublicDetail(
    viewerId: string,
    id: string,
  ): Promise<ListingDetailDto> {
    const version = await this.cache.getVersion(LISTINGS_CACHE_NAMESPACE);
    let cached: ListingDetailDto | null = null;
    try {
      cached = await this.cache.getOrSet(
        `${LISTINGS_CACHE_NAMESPACE}:v${version}:detail:${id}`,
        LISTINGS_CACHE_TTL_SECONDS,
        async () => {
          const listing = await this.mustFind(id);
          const now = new Date();
          if (!isListingOpen(listing, now)) {
            // Thrown so that non-public listings are never written to the cache.
            throw new NotFoundException('Listing not found');
          }
          return ListingDetailDto.from(listing, now);
        },
      );
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }

    // A cached pre-order may have passed its deadline since it was stored.
    const now = new Date();
    if (
      cached &&
      (cached.orderDeadline === null ||
        new Date(cached.orderDeadline).getTime() > now.getTime())
    ) {
      return cached;
    }

    return ListingDetailDto.from(await this.getForViewer(viewerId, id), now);
  }

  listMine(sellerId: string, status?: ListingStatus): Promise<Listing[]> {
    return this.listings.findBySeller(sellerId, status);
  }

  private nextCursor(
    tsQuery: string | null,
    current: ListingCursor | null,
    page: OpenListingRow[],
  ): ListingCursor {
    if (tsQuery !== null) {
      const previous = current?.kind === 'ranked' ? current.offset : 0;
      return { kind: 'ranked', offset: previous + page.length };
    }
    const last = page[page.length - 1];
    return {
      kind: 'recent',
      publishedAt: last.published_at.toISOString(),
      id: last.id,
    };
  }

  private toSummary(row: OpenListingRow): ListingSummaryDto {
    return {
      id: row.id,
      title: row.title,
      mode: row.mode,
      category: {
        id: row.category_id,
        slug: row.category_slug,
        name: row.category_name,
      },
      seller: {
        id: row.seller_id,
        name: row.seller_name,
        avatarUrl: row.seller_avatar_url,
      },
      thumbnailUrl: row.image_key
        ? mediaUrl(thumbnailKey(row.image_key))
        : null,
      minUnitPrice: row.min_unit_price,
      minPriceUnit: row.min_price_unit,
      orderDeadline: row.order_deadline?.toISOString() ?? null,
      deliveryDate: row.delivery_date,
      publishedAt: row.published_at.toISOString(),
    };
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
