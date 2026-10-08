import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  ComboDto,
  ListingSellerDto,
} from '../../listings/dto/listing-response.dto.js';
import { ListingMode } from '../../listings/listings.constants.js';
import { OrderDetailDto } from '../../orders/dto/order-response.dto.js';
import { PaymentMethod } from '../../orders/orders.constants.js';

/** Why a line in the cart cannot be bought right now. */
export enum CartProblem {
  ListingNotOpen = 'LISTING_NOT_OPEN',
  OutOfStock = 'OUT_OF_STOCK',
}

export class CartLineDto {
  @ApiProperty({ format: 'uuid' })
  listingId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: ListingMode, enumName: 'ListingMode' })
  mode!: ListingMode;

  @ApiProperty()
  unit!: string;

  @ApiProperty({ description: 'Current price, integer VND' })
  unitPrice!: number;

  @ApiProperty({ type: [ComboDto] })
  combos!: ComboDto[];

  @ApiProperty()
  quantity!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'What is left of an in-stock product; null for a pre-order',
  })
  stockQuantity!: number | null;

  @ApiProperty({ type: String, nullable: true })
  thumbnailUrl!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  orderDeadline!: string | null;

  @ApiProperty({ description: 'Integer VND, with combos applied' })
  lineTotal!: number;

  @ApiProperty({ description: 'Integer VND, unit price × quantity' })
  listTotal!: number;

  @ApiProperty({ enum: CartProblem, enumName: 'CartProblem', nullable: true })
  problem!: CartProblem | null;
}

export class CartGroupDto {
  @ApiProperty({ type: ListingSellerDto })
  seller!: ListingSellerDto;

  @ApiProperty({ type: [CartLineDto] })
  lines!: CartLineDto[];
}

export class CartDto {
  @ApiProperty({ type: [CartGroupDto], description: 'One group per seller' })
  groups!: CartGroupDto[];

  @ApiProperty()
  lineCount!: number;
}

export class CartCountDto {
  @ApiProperty()
  count!: number;
}

export class SetCartLineDto {
  @ApiProperty({ description: 'Decimal string', example: '2' })
  @IsString()
  @MaxLength(16)
  quantity!: string;
}

export class CheckoutLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  listingId!: string;

  @ApiProperty({ description: 'Decimal string', example: '1.5' })
  @IsString()
  @MaxLength(16)
  quantity!: string;
}

export class CheckoutPreviewRequestDto {
  @ApiProperty({ type: [CheckoutLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineDto)
  lines!: CheckoutLineDto[];
}

export class CheckoutPreviewLineDto {
  @ApiProperty({ format: 'uuid' })
  listingId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ type: [ComboDto] })
  combos!: ComboDto[];

  @ApiProperty()
  lineTotal!: number;

  @ApiProperty()
  listTotal!: number;
}

export class CheckoutPreviewOrderDto {
  @ApiProperty({
    description: 'Identifies this order in POST /checkout',
    example: 'seller:6b1f…',
  })
  key!: string;

  @ApiProperty({ type: ListingSellerDto })
  seller!: ListingSellerDto;

  @ApiProperty()
  isPreorder!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  orderDeadline!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  deliveryDate!: string | null;

  @ApiProperty({ type: [CheckoutPreviewLineDto] })
  lines!: CheckoutPreviewLineDto[];

  @ApiProperty({ description: 'Integer VND, with combos applied' })
  totalAmount!: number;

  @ApiProperty({ description: 'Integer VND, before combos' })
  listTotal!: number;

  @ApiProperty({
    enum: PaymentMethod,
    enumName: 'PaymentMethod',
    isArray: true,
    description: 'Methods every listing in this order accepts',
  })
  paymentMethods!: PaymentMethod[];
}

export class CheckoutPreviewDto {
  @ApiProperty({ type: [CheckoutPreviewOrderDto] })
  orders!: CheckoutPreviewOrderDto[];
}

export class CheckoutOrderChoiceDto {
  @ApiProperty({ description: 'The key from the preview' })
  @IsString()
  @MaxLength(100)
  key!: string;

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

// There is no price here: the server prices every line.
export class CheckoutRequestDto extends CheckoutPreviewRequestDto {
  @ApiProperty({ type: [CheckoutOrderChoiceDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CheckoutOrderChoiceDto)
  orders!: CheckoutOrderChoiceDto[];

  @ApiProperty({
    description: 'True when buying from the cart: bought lines leave it',
  })
  @IsBoolean()
  fromCart!: boolean;
}

export class CheckoutResultDto {
  @ApiProperty({ type: [OrderDetailDto] })
  orders!: OrderDetailDto[];
}
