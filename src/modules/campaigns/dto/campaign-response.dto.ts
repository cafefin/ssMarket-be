import { ApiProperty } from '@nestjs/swagger';
import { CategoryResponseDto } from '../../categories/dto/category-response.dto.js';
import {
  ComboDto,
  combosOf,
  ListingImageDto,
  ListingSellerDto,
} from '../../listings/dto/listing-response.dto.js';
import { isCampaignOpen } from '../../listings/listing-rules.js';
import type { Listing } from '../../listings/listing.entity.js';
import { ListingStatus } from '../../listings/listings.constants.js';
import { mediaUrl, thumbnailKey } from '../../listings/media-url.js';
import { type Campaign, CampaignStatus } from '../campaign.entity.js';

const THUMBNAILS_MAX = 4;

/** What the seller is told about the orders on one product. */
export interface CampaignItemUsage {
  orderCount: number;
  /** True when any order line, even of a cancelled order, points at it. */
  referenced: boolean;
}

/** A product is on sale unless the seller stopped selling it. */
function isSelling(item: Listing): boolean {
  return item.status !== ListingStatus.Closed;
}

/** What other people may see: the product is open for orders. */
function isOpen(item: Listing): boolean {
  return item.status === ListingStatus.Open;
}

export class CampaignItemDto {
  @ApiProperty({ format: 'uuid', description: 'Also the id of its listing' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ example: 'cái' })
  unit!: string;

  @ApiProperty({ description: 'Integer VND' })
  unitPrice!: number;

  @ApiProperty({
    type: [ComboDto],
    description: '"N units for a set price", smallest first',
  })
  combos!: ComboDto[];

  @ApiProperty({ type: [ListingImageDto] })
  images!: ListingImageDto[];

  @ApiProperty({ description: 'False when the seller stopped selling it' })
  selling!: boolean;

  @ApiProperty({
    description: 'Orders that are not cancelled; 0 for non-owners',
  })
  orderCount!: number;

  @ApiProperty({
    description:
      'True when no order line ever referenced it, so it can be removed; false for non-owners',
  })
  removable!: boolean;

  /** `usage` is given for the seller only. */
  static from(item: Listing, usage?: CampaignItemUsage): CampaignItemDto {
    const dto = new CampaignItemDto();
    dto.id = item.id;
    dto.title = item.title;
    dto.description = item.description;
    dto.unit = item.unit;
    dto.unitPrice = item.unitPrice;
    dto.combos = combosOf(item.combos);
    dto.images = (item.images ?? []).map((image) =>
      ListingImageDto.from(image),
    );
    dto.selling = isSelling(item);
    dto.orderCount = usage?.orderCount ?? 0;
    dto.removable = usage ? !usage.referenced : false;
    return dto;
  }
}

export class CampaignSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: ListingSellerDto })
  seller!: ListingSellerDto;

  @ApiProperty({ type: CategoryResponseDto })
  category!: CategoryResponseDto;

  @ApiProperty({ type: String, format: 'date-time' })
  orderDeadline!: string;

  @ApiProperty({ type: String, format: 'date', description: 'YYYY-MM-DD' })
  deliveryDate!: string;

  @ApiProperty({ description: 'Products on sale' })
  itemCount!: number;

  @ApiProperty({
    description: 'Lowest unit price among items on sale, integer VND',
  })
  minPrice!: number;

  @ApiProperty({
    type: [String],
    description: 'Up to 4 thumbnails of the first items that have a photo',
  })
  thumbnails!: string[];
}

export class CampaignDetailDto extends CampaignSummaryDto {
  @ApiProperty()
  description!: string;

  @ApiProperty({ enum: CampaignStatus, enumName: 'CampaignStatus' })
  status!: CampaignStatus;

  @ApiProperty({
    description: 'True while buyers can order: open and the deadline is ahead',
  })
  isOpen!: boolean;

  @ApiProperty()
  acceptsPrepaidQr!: boolean;

  @ApiProperty()
  acceptsPayOnDelivery!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publishedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The earlier round this one was reopened from',
  })
  reopenedFromId!: string | null;

  @ApiProperty({
    type: [CampaignItemDto],
    description:
      'Products in display order. The seller gets all of them; others only those on sale.',
  })
  items!: CampaignItemDto[];

  /**
   * `usage` is the seller's view: every product, with its order numbers.
   * Without it only the products on sale are shown.
   */
  static from(
    campaign: Campaign,
    now: Date,
    usage?: ReadonlyMap<string, CampaignItemUsage>,
  ): CampaignDetailDto {
    // The seller's counts follow what they chose to sell; everyone else sees
    // only what is open, whatever state a stray product is in.
    const selling = campaign.items.filter(usage ? isSelling : isOpen);
    const dto = new CampaignDetailDto();
    dto.id = campaign.id;
    dto.title = campaign.title;
    dto.seller = ListingSellerDto.from(campaign.seller);
    dto.category = CategoryResponseDto.from(campaign.category);
    dto.orderDeadline = campaign.orderDeadline.toISOString();
    dto.deliveryDate = campaign.deliveryDate;
    dto.itemCount = selling.length;
    dto.minPrice =
      selling.length > 0
        ? Math.min(...selling.map((item) => item.unitPrice))
        : 0;
    dto.thumbnails = selling
      .flatMap((item) => (item.images ?? []).slice(0, 1))
      .slice(0, THUMBNAILS_MAX)
      .map((image) => mediaUrl(thumbnailKey(image.storageKey)));
    dto.description = campaign.description;
    dto.status = campaign.status;
    dto.isOpen = isCampaignOpen(campaign, now);
    dto.acceptsPrepaidQr = campaign.acceptsPrepaidQr;
    dto.acceptsPayOnDelivery = campaign.acceptsPayOnDelivery;
    dto.publishedAt = campaign.publishedAt?.toISOString() ?? null;
    dto.reopenedFromId = campaign.reopenedFromId ?? null;
    dto.items = usage
      ? campaign.items.map((item) =>
          CampaignItemDto.from(
            item,
            usage.get(item.id) ?? { orderCount: 0, referenced: false },
          ),
        )
      : selling.map((item) => CampaignItemDto.from(item));
    return dto;
  }
}

export class CampaignMineDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: CampaignStatus, enumName: 'CampaignStatus' })
  status!: CampaignStatus;

  @ApiProperty({
    description: 'True while buyers can order: open and the deadline is ahead',
  })
  isOpen!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  orderDeadline!: string;

  @ApiProperty({ type: String, format: 'date', description: 'YYYY-MM-DD' })
  deliveryDate!: string;

  @ApiProperty({ description: 'Products, on sale or not' })
  itemCount!: number;

  @ApiProperty({ description: 'Orders that are not cancelled' })
  orderCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class CampaignPageDto {
  @ApiProperty({ type: [CampaignSummaryDto] })
  items!: CampaignSummaryDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `cursor` to get the next page; null on the last page',
  })
  nextCursor!: string | null;
}
