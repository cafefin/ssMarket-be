import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CacheService } from '../../cache/cache.service.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { normalizeForSearch } from '../../common/text/normalize.js';
import { CategoriesService } from '../categories/categories.service.js';
import { isCampaignOpen } from '../listings/listing-rules.js';
import {
  LISTINGS_CACHE_NAMESPACE,
  ListingStatus,
} from '../listings/listings.constants.js';
import { UsersService } from '../users/users.service.js';
import {
  type CampaignInput,
  type CampaignItemInput,
  validateCampaignInput,
} from './campaign-rules.js';
import { type Campaign, CampaignStatus } from './campaign.entity.js';
import {
  CampaignItemsInUseError,
  CampaignsRepository,
  CampaignStateChangedError,
  type ItemWrite,
} from './campaigns.repository.js';
import {
  CampaignDetailDto,
  type CampaignMineDto,
} from './dto/campaign-response.dto.js';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly campaigns: CampaignsRepository,
    private readonly users: UsersService,
    private readonly categories: CategoriesService,
    private readonly cache: CacheService,
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
    const now = new Date();
    try {
      await this.campaigns.save(
        id,
        this.editableFields(input),
        input.items.map((item, index) =>
          this.itemWrite(item, index, campaign.status, now),
        ),
        currentIds.filter((itemId) => !kept.has(itemId)),
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

  /** Deletes a draft with its products. */
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
    await this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
  }

  /**
   * The seller sees the round in any state, every product and its order
   * numbers. Everyone else sees a published round with the products on
   * sale; a draft does not exist as far as they can tell.
   */
  async getDetail(viewerId: string, id: string): Promise<CampaignDetailDto> {
    const campaign = await this.campaigns.findById(id);
    const owner = campaign?.sellerId === viewerId;
    if (!campaign || (!owner && campaign.status === CampaignStatus.Draft)) {
      throw new NotFoundException('Round not found');
    }
    const now = new Date();
    if (!owner) {
      return CampaignDetailDto.from(campaign, now);
    }
    return CampaignDetailDto.from(
      campaign,
      now,
      await this.campaigns.itemUsage(id),
    );
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
