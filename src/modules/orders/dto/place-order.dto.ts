import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../orders.constants.js';

export class OrderLineInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({
    description: 'Decimal string, so no precision is lost in transit',
    example: '1.5',
  })
  @IsString()
  @MaxLength(16)
  quantity!: string;
}

// There is deliberately no price or total here: the server computes every
// amount from its own data, and unknown properties are rejected.
export class PlaceOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  listingId!: string;

  @ApiProperty({ type: [OrderLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines!: OrderLineInputDto[];

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @ApiProperty({ example: 'Tầng 7' })
  @IsString()
  @MaxLength(500)
  deliveryLocation!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class CancelOrderDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Required when the seller cancels',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}

/** The same fields as placing an order, for an order that already exists. */
export class EditOrderDto extends OmitType(PlaceOrderDto, [
  'listingId',
] as const) {}
