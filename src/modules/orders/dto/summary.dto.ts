import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsUUID,
} from 'class-validator';
import {
  FulfillmentStatus,
  PaymentMethod,
  PaymentStatus,
} from '../orders.constants.js';

export class SummaryListingDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ example: 'cái' })
  unit!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  orderDeadline!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  deliveryDate!: string | null;
}

export class SummaryBuyerDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;
}

export class SummaryRowDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ type: SummaryBuyerDto })
  buyer!: SummaryBuyerDto;

  @ApiProperty()
  deliveryLocation!: string;

  @ApiProperty({ description: 'Units of this product in the order' })
  quantity!: number;

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

export class SummaryTotalsDto {
  @ApiProperty()
  orderCount!: number;

  @ApiProperty({ description: 'Units ordered' })
  quantity!: number;

  @ApiProperty({ description: 'Integer VND' })
  totalAmount!: number;

  @ApiProperty({ description: 'Sum of orders whose payment is confirmed' })
  paidAmount!: number;

  @ApiProperty({ description: 'totalAmount minus paidAmount' })
  outstandingAmount!: number;
}

export class SalesSummaryDto {
  @ApiProperty({ type: SummaryListingDto })
  listing!: SummaryListingDto;

  @ApiProperty({ type: [SummaryRowDto] })
  rows!: SummaryRowDto[];

  @ApiProperty({
    type: SummaryTotalsDto,
    description: 'Cancelled orders never count towards totals',
  })
  totals!: SummaryTotalsDto;
}

export const BULK_ACTIONS = ['deliver', 'confirm_payment'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export class BulkOrdersDto {
  @ApiProperty({ enum: BULK_ACTIONS })
  @IsIn(BULK_ACTIONS)
  action!: BulkAction;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  orderIds!: string[];
}

export class BulkResultDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty()
  ok!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why this order was skipped, e.g. INVALID_ORDER_STATE',
  })
  code!: string | null;
}

export class BulkResponseDto {
  @ApiProperty({ type: [BulkResultDto] })
  results!: BulkResultDto[];
}
