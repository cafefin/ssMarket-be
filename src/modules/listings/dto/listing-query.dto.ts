import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ListingMode, ListingSort } from '../listings.constants.js';

export class ListingQueryDto {
  @ApiPropertyOptional({ description: 'Keywords, with or without diacritics' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Category slug', example: 'dien-tu' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @ApiPropertyOptional({ enum: ListingMode, enumName: 'ListingMode' })
  @IsOptional()
  @IsEnum(ListingMode)
  mode?: ListingMode;

  @ApiPropertyOptional({
    enum: ListingSort,
    enumName: 'ListingSort',
    default: ListingSort.Recent,
    description:
      '`deadline` returns only pre-orders, closing soonest first; it cannot ' +
      'be combined with `q` or `mode=in_stock`',
  })
  @IsOptional()
  @IsEnum(ListingSort)
  sort?: ListingSort;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only this seller' })
  @IsOptional()
  @IsUUID()
  seller?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 48, default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}
