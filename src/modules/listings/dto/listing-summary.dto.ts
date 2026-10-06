import { ApiProperty } from '@nestjs/swagger';
import { CategoryResponseDto } from '../../categories/dto/category-response.dto.js';
import { ListingMode } from '../listings.constants.js';
import { ListingSellerDto } from './listing-response.dto.js';

export class ListingSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: ListingMode, enumName: 'ListingMode' })
  mode!: ListingMode;

  @ApiProperty({ type: CategoryResponseDto })
  category!: CategoryResponseDto;

  @ApiProperty({ type: ListingSellerDto })
  seller!: ListingSellerDto;

  @ApiProperty({ type: String, nullable: true })
  thumbnailUrl!: string | null;

  @ApiProperty({
    description: 'Lowest unit price among the items, integer VND',
  })
  minUnitPrice!: number;

  @ApiProperty({ description: 'Unit of the cheapest item', example: 'kg' })
  minPriceUnit!: string;

  @ApiProperty({ description: 'Orders that have not been cancelled' })
  orderCount!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Remaining stock, only for an in-stock listing with exactly one item ' +
      'that has a stock limit; null otherwise',
  })
  stockQuantity!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  orderDeadline!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  deliveryDate!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  publishedAt!: string;
}

export class ListingPageDto {
  @ApiProperty({ type: [ListingSummaryDto] })
  items!: ListingSummaryDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `cursor` to get the next page; null on the last page',
  })
  nextCursor!: string | null;
}
