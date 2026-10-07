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
  IsUUID,
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

export class ListingItemInputDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'When editing: the id of an existing item to keep. Omit for a new item.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Cam sành' })
  @IsString()
  @MaxLength(500)
  name!: string;

  @ApiProperty({ enum: LISTING_UNITS, example: 'kg' })
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
      'Decimal string, up to 3 fraction digits. Required for in-stock listings, null for pre-order.',
    example: '2.5',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  stockQuantity?: string | null;
}

export class ListingInputDto {
  @ApiProperty({ enum: ListingMode, enumName: 'ListingMode' })
  @IsEnum(ListingMode)
  mode!: ListingMode;

  @ApiProperty({ example: 'Hoa quả tuần 41' })
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

  @ApiProperty({ type: [ListingItemInputDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ListingItemInputDto)
  items!: ListingItemInputDto[];

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
      items: this.items.map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        unitPrice: item.unitPrice,
        stockQuantity: item.stockQuantity ?? null,
      })),
    };
  }
}
