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

  @ApiProperty({ description: 'Integer VND' })
  unitPrice!: number;

  @ApiProperty({ example: 'cái' })
  unit!: string;

  @ApiProperty({ description: 'Orders that have not been cancelled' })
  orderCount!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Remaining stock of an in-stock product; null for a pre-order',
  })
  stockQuantity!: number | null;

  @ApiProperty({ description: 'True when the product has a combo price' })
  hasCombos!: boolean;

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
