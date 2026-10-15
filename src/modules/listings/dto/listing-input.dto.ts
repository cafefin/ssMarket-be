import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
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
  @ApiProperty({
    enum: ListingMode,
    enumName: 'ListingMode',
    description: 'Only `in_stock`; pre-orders are created as a round',
  })
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
      'Decimal string, up to 3 fraction digits. Required for in-stock products.',
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
