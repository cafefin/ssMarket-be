import { ApiProperty } from '@nestjs/swagger';
import { CategoryResponseDto } from '../../categories/dto/category-response.dto.js';
import { ListingCondition, ListingMode } from '../listings.constants.js';
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

  @ApiProperty({ description: 'True when some option has a combo price' })
  hasCombos!: boolean;

  @ApiProperty({ description: 'Active options (items) of the listing' })
  itemCount!: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The id of the only option when there is exactly one, so the list can ' +
      'add it to the cart directly; null otherwise',
  })
  singleItemId!: string | null;

  @ApiProperty({
    enum: ListingCondition,
    enumName: 'ListingCondition',
    nullable: true,
  })
  condition!: ListingCondition | null;

  @ApiProperty({ type: Number, nullable: true, example: 99 })
  conditionPercent!: number | null;

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
