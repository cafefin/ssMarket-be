import { ApiProperty } from '@nestjs/swagger';
import { CategoryResponseDto } from '../../categories/dto/category-response.dto.js';
import type { User } from '../../users/user.entity.js';
import type { ListingImage } from '../listing-image.entity.js';
import type { ListingItem } from '../listing-item.entity.js';
import { isListingOpen } from '../listing-rules.js';
import type { Listing } from '../listing.entity.js';
import { ListingMode, ListingStatus } from '../listings.constants.js';
import { mediaUrl, thumbnailKey } from '../media-url.js';

export class ListingSellerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  static from(user: User): ListingSellerDto {
    const dto = new ListingSellerDto();
    dto.id = user.id;
    dto.name = user.name;
    dto.avatarUrl = user.avatarUrl;
    return dto;
  }
}

export class ListingItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty({ description: 'Integer VND' })
  unitPrice!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Remaining stock; null means unlimited',
  })
  stockQuantity!: number | null;

  static from(item: ListingItem): ListingItemDto {
    const dto = new ListingItemDto();
    dto.id = item.id;
    dto.name = item.name;
    dto.unit = item.unit;
    dto.unitPrice = item.unitPrice;
    dto.stockQuantity =
      item.stockQuantity === null ? null : Number(item.stockQuantity);
    return dto;
  }
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

  @ApiProperty({ type: [ListingItemDto] })
  items!: ListingItemDto[];

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
    dto.items = listing.items
      .filter((item) => item.isActive)
      .map((item) => ListingItemDto.from(item));
    dto.images = listing.images.map((image) => ListingImageDto.from(image));
    return dto;
  }
}
