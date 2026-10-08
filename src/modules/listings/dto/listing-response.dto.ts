import { ApiProperty } from '@nestjs/swagger';
import { CategoryResponseDto } from '../../categories/dto/category-response.dto.js';
import type { User } from '../../users/user.entity.js';
import type { ListingImage } from '../listing-image.entity.js';
import type { ListingCombo } from '../listing-combo.entity.js';
import { isListingOpen } from '../listing-rules.js';
import type { Listing } from '../listing.entity.js';
import {
  CONDITION_PERCENT,
  ListingCondition,
  ListingMode,
  ListingStatus,
} from '../listings.constants.js';
import { mediaUrl, thumbnailKey } from '../media-url.js';

export class ListingSellerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description: 'The part of the work email before @, e.g. "an.nguyen"',
  })
  handle!: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  static from(user: User): ListingSellerDto {
    const dto = new ListingSellerDto();
    dto.id = user.id;
    dto.name = user.name;
    dto.handle = emailHandle(user.email);
    dto.avatarUrl = user.avatarUrl;
    return dto;
  }
}

/** "an.nguyen@company.vn" -> "an.nguyen". */
export function emailHandle(email: string): string {
  return email.split('@')[0];
}

export class ComboDto {
  @ApiProperty({ description: 'Decimal string', example: '100' })
  quantity!: string;

  @ApiProperty({ description: 'Price of the whole combo, integer VND' })
  price!: number;
}

/** "100.000" from PostgreSQL numeric -> "100"; "2.500" -> "2.5". */
function normalizeDecimal(value: string): string {
  return String(Number(value));
}

/** A product's combos, smallest first, with quantities as plain decimals. */
export function combosOf(
  combos: ReadonlyArray<Pick<ListingCombo, 'quantity' | 'price'>> | undefined,
): ComboDto[] {
  return (combos ?? [])
    .map((combo) => ({
      quantity: normalizeDecimal(combo.quantity),
      price: combo.price,
    }))
    .sort((a, b) => Number(a.quantity) - Number(b.quantity));
}

export class ListingImageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty()
  thumbnailUrl!: string;

  static from(image: ListingImage): ListingImageDto {
    const dto = new ListingImageDto();
    dto.id = image.id;
    dto.url = mediaUrl(image.storageKey);
    dto.thumbnailUrl = mediaUrl(thumbnailKey(image.storageKey));
    return dto;
  }
}

export class ListingDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ enum: ListingMode, enumName: 'ListingMode' })
  mode!: ListingMode;

  @ApiProperty({ enum: ListingStatus, enumName: 'ListingStatus' })
  status!: ListingStatus;

  @ApiProperty({
    description: 'True while buyers can see the listing',
  })
  isOpen!: boolean;

  @ApiProperty({ type: CategoryResponseDto })
  category!: CategoryResponseDto;

  @ApiProperty({ type: ListingSellerDto })
  seller!: ListingSellerDto;

  @ApiProperty()
  acceptsPrepaidQr!: boolean;

  @ApiProperty()
  acceptsPayOnDelivery!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  orderDeadline!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  deliveryDate!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publishedAt!: string | null;

  @ApiProperty({ description: 'Orders that have not been cancelled' })
  orderCount!: number;

  @ApiProperty({
    enum: ListingCondition,
    enumName: 'ListingCondition',
    nullable: true,
  })
  condition!: ListingCondition | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The percentage of `condition`, e.g. 99',
  })
  conditionPercent!: number | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The earlier round this listing was reopened from',
  })
  reopenedFromId!: string | null;

  @ApiProperty({ example: 'cái' })
  unit!: string;

  @ApiProperty({ description: 'Integer VND' })
  unitPrice!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Remaining stock of an in-stock product; null for a pre-order',
  })
  stockQuantity!: number | null;

  @ApiProperty({
    type: [ComboDto],
    description: '"N units for a set price", smallest first',
  })
  combos!: ComboDto[];

  @ApiProperty({ type: [ListingImageDto] })
  images!: ListingImageDto[];

  static from(listing: Listing, now: Date): ListingDetailDto {
    const dto = new ListingDetailDto();
    dto.id = listing.id;
    dto.title = listing.title;
    dto.description = listing.description;
    dto.mode = listing.mode;
    dto.status = listing.status;
    dto.isOpen = isListingOpen(listing, now);
    dto.category = CategoryResponseDto.from(listing.category);
    dto.seller = ListingSellerDto.from(listing.seller);
    dto.acceptsPrepaidQr = listing.acceptsPrepaidQr;
    dto.acceptsPayOnDelivery = listing.acceptsPayOnDelivery;
    dto.orderDeadline = listing.orderDeadline?.toISOString() ?? null;
    dto.deliveryDate = listing.deliveryDate;
    dto.publishedAt = listing.publishedAt?.toISOString() ?? null;
    dto.orderCount = listing.orderCount ?? 0;
    dto.condition = listing.condition ?? null;
    dto.conditionPercent = listing.condition
      ? CONDITION_PERCENT[listing.condition]
      : null;
    dto.reopenedFromId = listing.reopenedFromId ?? null;
    dto.unit = listing.unit;
    dto.unitPrice = listing.unitPrice;
    dto.stockQuantity =
      listing.stockQuantity === null ? null : Number(listing.stockQuantity);
    dto.combos = combosOf(listing.combos);
    dto.images = listing.images.map((image) => ListingImageDto.from(image));
    return dto;
  }
}
