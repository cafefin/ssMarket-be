import { ApiProperty } from '@nestjs/swagger';
import { ListingCampaignDto } from '../../listings/dto/listing-campaign.dto.js';
import {
  FulfillmentStatus,
  PaymentMethod,
  PaymentStatus,
} from '../orders.constants.js';
import { SummaryBuyerDto } from './summary.dto.js';

export class CampaignSummaryItemDto {
  @ApiProperty({ format: 'uuid' })
  listingId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ example: 'cái' })
  unit!: string;
}

export class CampaignSummaryRowDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ type: SummaryBuyerDto })
  buyer!: SummaryBuyerDto;

  @ApiProperty()
  deliveryLocation!: string;

  @ApiProperty({
    type: [Number],
    description:
      'Units of each product, in the order of `items`; 0 when not ordered',
  })
  quantities!: number[];

  @ApiProperty({ description: 'Integer VND' })
  totalAmount!: number;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  paymentMethod!: PaymentMethod;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  paymentStatus!: PaymentStatus;

  @ApiProperty({ enum: FulfillmentStatus, enumName: 'FulfillmentStatus' })
  fulfillmentStatus!: FulfillmentStatus;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class CampaignSummaryTotalsDto {
  @ApiProperty()
  orderCount!: number;

  @ApiProperty({ description: 'Integer VND' })
  totalAmount!: number;

  @ApiProperty({ description: 'Sum of orders whose payment is confirmed' })
  paidAmount!: number;

  @ApiProperty({ description: 'totalAmount minus paidAmount' })
  outstandingAmount!: number;
}

export class CampaignSummaryTableDto {
  @ApiProperty({ type: ListingCampaignDto })
  campaign!: ListingCampaignDto;

  @ApiProperty({
    type: [CampaignSummaryItemDto],
    description:
      'Products on sale or ordered, in the order of the round; one column each',
  })
  items!: CampaignSummaryItemDto[];

  @ApiProperty({ type: [CampaignSummaryRowDto] })
  rows!: CampaignSummaryRowDto[];

  @ApiProperty({
    type: [Number],
    description: 'Units per product in live orders, in the order of `items`',
  })
  itemTotals!: number[];

  @ApiProperty({
    type: CampaignSummaryTotalsDto,
    description: 'Cancelled orders never count towards totals',
  })
  totals!: CampaignSummaryTotalsDto;
}

export class CampaignMyOrderDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The buyer’s live order in this round, or null',
  })
  orderId!: string | null;
}
