import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ComboInputDto } from '../../listings/dto/listing-input.dto.js';
import { LISTING_UNITS } from '../../listings/listings.constants.js';
import type { CampaignInput } from '../campaign-rules.js';

// These classes check shape and types only. Business rules live in
// validateCampaignInput so they are tested without HTTP.

export class CampaignItemInputDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The product to change; leave out to add a product. A product of the round that is not sent is removed.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Bánh bao chay' })
  @IsString()
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional({ default: '' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @ApiProperty({ enum: LISTING_UNITS, example: 'cái' })
  @IsString()
  @MaxLength(16)
  unit!: string;

  @ApiProperty({ description: 'Integer VND', example: 15000 })
  @IsInt()
  unitPrice!: number;

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

  @ApiPropertyOptional({
    default: true,
    description: 'False stops selling the product without removing it',
  })
  @IsOptional()
  @IsBoolean()
  selling?: boolean;
}

export class CampaignInputDto {
  @ApiProperty({ example: 'Bánh bao tuần này' })
  @IsString()
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional({ default: '' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  categoryId!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsISO8601({ strict: true })
  orderDeadline!: string;

  @ApiProperty({ type: String, format: 'date', description: 'YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'deliveryDate must be YYYY-MM-DD',
  })
  deliveryDate!: string;

  @ApiProperty()
  @IsBoolean()
  acceptsPrepaidQr!: boolean;

  @ApiProperty()
  @IsBoolean()
  acceptsPayOnDelivery!: boolean;

  @ApiProperty({
    type: [CampaignItemInputDto],
    description: 'The products of the round, in display order; 1 to 50',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CampaignItemInputDto)
  items!: CampaignItemInputDto[];

  toInput(): CampaignInput {
    return {
      title: this.title,
      description: this.description ?? '',
      categoryId: this.categoryId,
      orderDeadline: new Date(this.orderDeadline),
      deliveryDate: this.deliveryDate,
      acceptsPrepaidQr: this.acceptsPrepaidQr,
      acceptsPayOnDelivery: this.acceptsPayOnDelivery,
      items: this.items.map((item) => ({
        id: item.id ?? null,
        title: item.title,
        description: item.description ?? '',
        unit: item.unit,
        unitPrice: item.unitPrice,
        combos: (item.combos ?? []).map((combo) => ({
          quantity: combo.quantity,
          price: combo.price,
        })),
        selling: item.selling ?? true,
      })),
    };
  }
}
