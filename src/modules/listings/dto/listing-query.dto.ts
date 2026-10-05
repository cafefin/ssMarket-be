import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ListingMode } from '../listings.constants.js';

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
