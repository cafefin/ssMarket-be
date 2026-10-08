import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { ListingInput } from '../listing-rules.js';
import {
  LISTING_UNITS,
  ListingCondition,
  ListingMode,
} from '../listings.constants.js';

// These classes check shape and types only. Business rules live in
// validateListingInput so they are tested without HTTP.

export class ComboInputDto {
  @ApiProperty({ description: 'Decimal string', example: '100' })
  @IsString()
  @MaxLength(16)
  quantity!: string;

  @ApiProperty({
    description: 'Price of the whole combo, integer VND',
    example: 900000,
  })
  @IsInt()
  price!: number;
}

export class ListingInputDto {
  @ApiProperty({ enum: ListingMode, enumName: 'ListingMode' })
  @IsEnum(ListingMode)
  mode!: ListingMode;

  @ApiProperty({ example: 'Loa JBL Go 3' })
  @IsString()
  @MaxLength(500)
  title!: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  categoryId!: number;

  @ApiPropertyOptional({ default: '' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @ApiProperty()
  @IsBoolean()
  acceptsPrepaidQr!: boolean;

  @ApiProperty()
  @IsBoolean()
  acceptsPayOnDelivery!: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Pre-order only',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  orderDeadline?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    description: 'Pre-order only, YYYY-MM-DD',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'deliveryDate must be YYYY-MM-DD',
  })
  deliveryDate?: string | null;

  @ApiPropertyOptional({
    enum: ListingCondition,
    enumName: 'ListingCondition',
    nullable: true,
    description:
      'Required for in-stock goods outside food categories; null otherwise',
  })
  @IsOptional()
  @IsEnum(ListingCondition)
  condition?: ListingCondition | null;

  @ApiProperty({ enum: LISTING_UNITS, example: 'cái' })
  @IsString()
  @MaxLength(16)
  unit!: string;

  @ApiProperty({ description: 'Integer VND', example: 35000 })
  @IsInt()
  unitPrice!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Decimal string, up to 3 fraction digits. Required for in-stock products, null for pre-orders.',
    example: '2',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  stockQuantity?: string | null;

  @ApiPropertyOptional({
    type: [ComboInputDto],
    description: '"N units for a set price"; at most 3',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ComboInputDto)
  combos?: ComboInputDto[];

  toInput(): ListingInput {
    return {
      mode: this.mode,
      title: this.title,
      categoryId: this.categoryId,
      description: this.description ?? '',
      acceptsPrepaidQr: this.acceptsPrepaidQr,
      acceptsPayOnDelivery: this.acceptsPayOnDelivery,
      orderDeadline: this.orderDeadline ? new Date(this.orderDeadline) : null,
      deliveryDate: this.deliveryDate ?? null,
      condition: this.condition ?? null,
      unit: this.unit,
      unitPrice: this.unitPrice,
      stockQuantity: this.stockQuantity ?? null,
      combos: (this.combos ?? []).map((combo) => ({
        quantity: combo.quantity,
        price: combo.price,
      })),
    };
  }
}
