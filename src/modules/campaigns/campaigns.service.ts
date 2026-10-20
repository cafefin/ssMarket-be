import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CacheService } from '../../cache/cache.service.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { normalizeForSearch } from '../../common/text/normalize.js';
import { OutboxService } from '../../events/outbox.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import { emailHandle } from '../listings/dto/listing-response.dto.js';
import { ListingImagesService } from '../listings/listing-images.service.js';
import type { Listing } from '../listings/listing.entity.js';
import {
  isCampaignOpen,
  suggestReopenDates,
} from '../listings/listing-rules.js';
import {
  LISTINGS_CACHE_NAMESPACE,
  LISTINGS_CACHE_TTL_SECONDS,
  ListingStatus,
} from '../listings/listings.constants.js';
import { mediaUrl, thumbnailKey } from '../listings/media-url.js';
import { toTsQuery } from '../listings/search-query.js';
import { UsersService } from '../users/users.service.js';
import { campaignPublishedEvent } from './campaign-events.js';
import {
  decodeCampaignCursor,
  encodeCampaignCursor,
} from './campaign-cursor.js';
import {
  type CampaignInput,
  type CampaignItemInput,
  validateCampaignInput,
} from './campaign-rules.js';
import { type Campaign, CampaignStatus } from './campaign.entity.js';
import {
  CampaignItemsInUseError,
  type CampaignOpenRow,
  CampaignsRepository,
  CampaignStateChangedError,
  type ItemWrite,
} from './campaigns.repository.js';
import {
  CampaignDetailDto,
  type CampaignMineDto,
  type CampaignPageDto,
  type CampaignSummaryDto,
} from './dto/campaign-response.dto.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface CampaignSearchParams {
  q?: string;
  /** Category slug. */
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sellerId?: string;
  cursor?: string;
  /** Default 20, 1..50. */
  limit?: number;
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly campaigns: CampaignsRepository,
    private readonly users: UsersService,
    private readonly categories: CategoriesService,
    private readonly cache: CacheService,
    private readonly images: ListingImagesService,
    private readonly outbox: OutboxService,
  ) {}

  /** Creates a draft round with its products. */
  async create(sellerId: string, input: CampaignInput): Promise<Campaign> {
    await this.assertValid(sellerId, input, null);
    this.assertKnownItems(input, new Set());

    const id = await this.campaigns.insert(
      {
        sellerId,
        status: CampaignStatus.Draft,
        publishedAt: null,
        closedAt: null,
        ...this.editableFields(input),
      },
      input.items.map((item, index) =>
        this.itemWrite(item, index, CampaignStatus.Draft, null),
      ),
    );

    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
    return this.mustFind(id);
  }

  /**
   * Changes the shared terms and the list of products: an item with an id
   * is changed, one without is added, and one that is left out is removed.
   */
  async update(
    sellerId: string,
    id: string,
    input: CampaignInput,
  ): Promise<Campaign> {
    const campaign = await this.findOwned(sellerId, id);
    if (campaign.status === CampaignStatus.Closed) {
      throw this.invalidState('A closed round cannot be edited');
    }
    await this.assertValid(sellerId, input, campaign.categoryId);
    const currentIds = campaign.items.map((item) => item.id);
    this.assertKnownItems(input, new Set(currentIds));

    const kept = new Set(input.items.map((item) => item.id));
    const removed = campaign.items.filter((item) => !kept.has(item.id));
    const now = new Date();
    try {
      await this.campaigns.save(
        id,
        this.editableFields(input),
        input.items.map((item, index) =>
          this.itemWrite(item, index, campaign.status, now),
        ),
        removed.map((item) => item.id),
        campaign.status,
      );
    } catch (error) {
      if (error instanceof CampaignItemsInUseError) {
        throw new DomainException(
          409,
          'CAMPAIGN_ITEM_HAS_ORDERS',
          'Some products already have orders; stop selling them instead',
          { items: error.items },
        );
      }
      this.rethrowStateChange(error);
    }

    // The image rows went with their products; the files go now that the
    // save is committed.
    await this.images.removeFiles(storageKeysOf(removed));
    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
    return this.mustFind(id);
  }

  async publish(sellerId: string, id: string): Promise<Campaign> {
    const campaign = await this.findOwned(sellerId, id);
    if (campaign.status !== CampaignStatus.Draft) {
      throw this.invalidState('Only a draft can be published');
    }
    const now = new Date();
    if (campaign.orderDeadline.getTime() <= now.getTime()) {
      throw new BadRequestException('The order deadline must be in the future');
    }
    if (campaign.acceptsPrepaidQr) {
      await this.assertBankProfile(sellerId);
    }
    // The category may have been hidden after this draft was written.
    const category = await this.categories.findById(campaign.categoryId);
    if (!category?.isActive) {
      throw this.categoryInactive();
    }

    try {
      await this.campaigns.setStatus(
        id,
        { status: CampaignStatus.Open, publishedAt: now },
        CampaignStatus.Draft,
        { from: ListingStatus.Draft, to: ListingStatus.Open, publishedAt: now },
        (tx) =>
          this.outbox
            .add(tx, campaignPublishedEvent(campaign))
            .then(() => undefined),
      );
    } catch (error) {
      this.rethrowStateChange(error);
    }

    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
    return this.mustFind(id);
  }

  /** Ends the round early. Its products keep their status; the round decides. */
  async close(sellerId: string, id: string): Promise<Campaign> {
    const campaign = await this.findOwned(sellerId, id);
    if (campaign.status !== CampaignStatus.Open) {
      throw this.invalidState('Only an open round can be closed');
    }

    try {
      await this.campaigns.setStatus(
        id,
        { status: CampaignStatus.Closed, closedAt: new Date() },
        CampaignStatus.Open,
      );
    } catch (error) {
      this.rethrowStateChange(error);
    }

    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
    return this.mustFind(id);
  }

  /** Deletes a draft with its products and their photo files. */
  async remove(sellerId: string, id: string): Promise<void> {
    const campaign = await this.findOwned(sellerId, id);
    if (campaign.status !== CampaignStatus.Draft) {
      throw this.invalidState('Only a draft can be deleted');
    }
    try {
      await this.campaigns.delete(id, CampaignStatus.Draft);
    } catch (error) {
      this.rethrowStateChange(error);
    }
    await this.images.removeFiles(storageKeysOf(campaign.items));
    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
  }

  /**
   * The seller sees the round in any state, every product and its order
   * numbers, always from the database. Everyone else sees a published round
   * with the products on sale, from the cache; a draft does not exist as far
   * as they can tell.
   */
  async getDetail(viewerId: string, id: string): Promise<CampaignDetailDto> {
    const version = await this.cache.getVersion(LISTINGS_CACHE_NAMESPACE);
    let cached: CampaignDetailDto | null = null;
    try {
      cached = await this.cache.getOrSet(
        `${LISTINGS_CACHE_NAMESPACE}:v${version}:campaign:${id}`,
        LISTINGS_CACHE_TTL_SECONDS,
        async () => {
          const campaign = await this.campaigns.findById(id);
          if (!campaign || campaign.status === CampaignStatus.Draft) {
            // Thrown so that a draft is never written to the cache.
            throw new NotFoundException('Round not found');
          }
          return CampaignDetailDto.from(campaign, new Date());
        },
      );
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }

    const now = new Date();
    if (cached && cached.seller.id !== viewerId) {
      // The deadline may have passed since the copy was stored.
      return Object.assign(new CampaignDetailDto(), cached, {
        isOpen: isCampaignOpen(
          {
            status: cached.status,
            orderDeadline: new Date(cached.orderDeadline),
          },
          now,
        ),
      });
    }

    const campaign = await this.campaigns.findById(id);
    if (!campaign || campaign.sellerId !== viewerId) {
      throw new NotFoundException('Round not found');
    }
    return CampaignDetailDto.from(
      campaign,
      now,
      await this.campaigns.itemUsage(id),
    );
  }

  /** Browse open rounds, soonest deadline first. Cached for a minute. */
  async search(params: CampaignSearchParams): Promise<CampaignPageDto> {
    const limit = Math.min(
      Math.max(params.limit ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const tsQuery = params.q ? toTsQuery(params.q) : null;
    if (
      params.minPrice !== undefined &&
      params.maxPrice !== undefined &&
      params.minPrice > params.maxPrice
    ) {
      throw new BadRequestException('minPrice cannot be above maxPrice');
    }
    const cursor = params.cursor ? decodeCampaignCursor(params.cursor) : null;

    let categoryId: number | null = null;
    if (params.category) {
      const category = await this.categories.findBySlug(params.category);
      if (!category) {
        return { items: [], nextCursor: null };
      }
      categoryId = category.id;
    }
    const sellerId = params.sellerId ?? null;
    const minPrice = params.minPrice ?? null;
    const maxPrice = params.maxPrice ?? null;

    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          tsQuery,
          categoryId,
          cursor,
          limit,
          sellerId,
          minPrice,
          maxPrice,
        ]),
      )
      .digest('hex');
    const version = await this.cache.getVersion(LISTINGS_CACHE_NAMESPACE);

    return this.cache.getOrSet(
      `${LISTINGS_CACHE_NAMESPACE}:v${version}:campaigns:${fingerprint}`,
      LISTINGS_CACHE_TTL_SECONDS,
      async () => {
        const rows = await this.campaigns.searchOpen({
          tsQuery,
          categoryId,
          sellerId,
          minPrice,
          maxPrice,
          cursor,
          limit: limit + 1,
          now: new Date(),
        });
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return {
          items: page.map((row) => this.toSummary(row)),
          nextCursor:
            rows.length > limit && last
              ? encodeCampaignCursor({
                  orderDeadline: last.order_deadline.toISOString(),
                  id: last.id,
                })
              : null,
        };
      },
    );
  }

  /**
   * Copies a finished round into a new draft: the same terms, the products
   * that were on sale (with combos and photos), and dates moved forward by
   * whole weeks. All or nothing: when a photo cannot be copied the new draft
   * is deleted again and the error surfaces.
   */
  async reopen(sellerId: string, id: string): Promise<Campaign> {
    const source = await this.findOwned(sellerId, id);
    const now = new Date();
    if (source.status === CampaignStatus.Draft || isCampaignOpen(source, now)) {
      throw this.invalidState('Only a finished round can be reopened');
    }

    const kept = source.items.filter(
      (item) => item.status !== ListingStatus.Closed,
    );
    const newId = await this.campaigns.insert(
      {
        sellerId,
        categoryId: source.categoryId,
        title: source.title,
        description: source.description,
        acceptsPrepaidQr: source.acceptsPrepaidQr,
        acceptsPayOnDelivery: source.acceptsPayOnDelivery,
        searchText: source.searchText,
        ...suggestReopenDates(source.orderDeadline, source.deliveryDate, now),
        status: CampaignStatus.Draft,
        publishedAt: null,
        closedAt: null,
        reopenedFromId: source.id,
      },
      kept.map((item, index) => ({
        id: null,
        title: item.title,
        description: item.description,
        unit: item.unit,
        unitPrice: item.unitPrice,
        combos: (item.combos ?? []).map((combo) => ({
          quantity: combo.quantity,
          price: combo.price,
        })),
        status: ListingStatus.Draft,
        sortOrder: index,
        publishedAt: null,
      })),
    );

    const created = await this.mustFind(newId);
    const twins = [...created.items].sort((a, b) => a.sortOrder - b.sortOrder);
    try {
      for (const [index, item] of kept.entries()) {
        await this.images.copyAll(item.images ?? [], twins[index].id);
      }
    } catch (error) {
      // A draft without its photos is worse than no draft: take it back.
      await this.discardDraft(newId);
      throw error;
    }

    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
    return created;
  }

  /** The seller's rounds in any state, newest first. */
  async listMine(sellerId: string): Promise<CampaignMineDto[]> {
    const now = new Date();
    const rows = await this.campaigns.findBySeller(sellerId);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      isOpen: isCampaignOpen(
        { status: row.status, orderDeadline: row.order_deadline },
        now,
      ),
      orderDeadline: row.order_deadline.toISOString(),
      deliveryDate: row.delivery_date,
      itemCount: row.item_count,
      orderCount: row.order_count,
      createdAt: row.created_at.toISOString(),
    }));
  }

  /** Any campaign with seller, category and items (with combos and images); for other modules. */
  findById(id: string): Promise<Campaign | null> {
    return this.campaigns.findById(id);
  }

  /** 404 when missing, 403 when not the seller's. */
  async findOwned(sellerId: string, id: string): Promise<Campaign> {
    const campaign = await this.mustFind(id);
    if (campaign.sellerId !== sellerId) {
      throw new ForbiddenException('You can only change your own rounds');
    }
    return campaign;
  }

  private toSummary(row: CampaignOpenRow): CampaignSummaryDto {
    return {
      id: row.id,
      title: row.title,
      seller: {
        id: row.seller_id,
        name: row.seller_name,
        handle: emailHandle(row.seller_email),
        avatarUrl: row.seller_avatar_url,
      },
      category: {
        id: row.category_id,
        slug: row.category_slug,
        name: row.category_name,
        nameEn: row.category_name_en,
        isPerishable: row.category_is_perishable,
      },
      orderDeadline: row.order_deadline.toISOString(),
      deliveryDate: row.delivery_date,
      itemCount: row.item_count,
      minPrice: row.min_price,
      thumbnails: row.image_keys.map((key) => mediaUrl(thumbnailKey(key))),
    };
  }

  /**
   * Deletes a draft that `reopen` could not finish, with the photos it
   * already got. Never throws, so the caller's error is the one that
   * surfaces; a failure here is logged.
   */
  private async discardDraft(id: string): Promise<void> {
    try {
      const draft = await this.campaigns.findById(id);
      await this.campaigns.delete(id, CampaignStatus.Draft);
      await this.images.removeFiles(storageKeysOf(draft?.items ?? []));
    } catch (error) {
      this.logger.error(
        `Could not delete the unfinished draft ${id}: ${String(error)}`,
      );
    }
  }

  private async mustFind(id: string): Promise<Campaign> {
    const campaign = await this.campaigns.findById(id);
    if (!campaign) {
      throw new NotFoundException('Round not found');
    }
    return campaign;
  }

  private async assertValid(
    sellerId: string,
    input: CampaignInput,
    /** The round's category before this edit; null when creating. */
    currentCategoryId: number | null,
  ): Promise<void> {
    const category = await this.categories.findById(input.categoryId);
    if (!category) {
      throw new BadRequestException('Unknown category');
    }
    const problems = validateCampaignInput(input);
    if (problems.length > 0) {
      throw this.invalidCampaign(problems);
    }
    // A round already in a hidden category may stay there when edited.
    if (!category.isActive && category.id !== currentCategoryId) {
      throw this.categoryInactive();
    }
    if (input.acceptsPrepaidQr) {
      await this.assertBankProfile(sellerId);
    }
  }

  /** Every item id in the input must be a product of this round. */
  private assertKnownItems(
    input: CampaignInput,
    currentIds: ReadonlySet<string>,
  ): void {
    const problems = input.items.flatMap((item, index) =>
      item.id !== null && !currentIds.has(item.id)
        ? [`item ${index + 1}: unknown product`]
        : [],
    );
    if (problems.length > 0) {
      throw this.invalidCampaign(problems);
    }
  }

  private invalidCampaign(problems: string[]): DomainException {
    return new DomainException(422, 'INVALID_CAMPAIGN', problems.join('; '), {
      problems,
    });
  }

  private categoryInactive(): DomainException {
    return new DomainException(
      400,
      'CATEGORY_INACTIVE',
      'This category no longer takes listings',
    );
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

  /** Turns a lost race on the round's state into its HTTP error; rethrows anything else. */
  private rethrowStateChange(error: unknown): never {
    if (error instanceof CampaignStateChangedError) {
      if (error.missing) {
        throw new NotFoundException('Round not found');
      }
      throw this.invalidState('The round changed; reload and try again');
    }
    throw error;
  }

  private invalidState(message: string): DomainException {
    return new DomainException(409, 'INVALID_LISTING_STATE', message);
  }

  private editableFields(input: CampaignInput) {
    const title = input.title.trim();
    return {
      categoryId: input.categoryId,
      title,
      description: input.description,
      orderDeadline: input.orderDeadline,
      deliveryDate: input.deliveryDate,
      acceptsPrepaidQr: input.acceptsPrepaidQr,
      acceptsPayOnDelivery: input.acceptsPayOnDelivery,
      searchText: normalizeForSearch(title),
    };
  }

  /**
   * How one product is written. It is `closed` while not on sale; otherwise
   * it follows its round: `draft` in a draft, `open` in an open round.
   */
  private itemWrite(
    item: CampaignItemInput,
    index: number,
    campaignStatus: CampaignStatus,
    now: Date | null,
  ): ItemWrite {
    const open = campaignStatus === CampaignStatus.Open;
    const status = !item.selling
      ? ListingStatus.Closed
      : open
        ? ListingStatus.Open
        : ListingStatus.Draft;
    return {
      id: item.id,
      title: item.title.trim(),
      description: item.description,
      unit: item.unit,
      unitPrice: item.unitPrice,
      combos: item.combos.map((combo) => ({
        quantity: combo.quantity,
        price: combo.price,
      })),
      status,
      sortOrder: index,
      // A product first shows in lists when it goes on sale in an open round.
      publishedAt: status === ListingStatus.Open ? now : null,
    };
  }
}

/** The storage keys of every photo of the given products. */
function storageKeysOf(items: Listing[]): string[] {
  return items.flatMap((item) =>
    (item.images ?? []).map((image) => image.storageKey),
  );
}
