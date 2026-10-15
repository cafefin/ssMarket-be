import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CampaignQueryDto {
  @ApiPropertyOptional({
    description:
      'Keywords, with or without diacritics; matches the round or any of its products',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Category slug', example: 'do-an' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @ApiPropertyOptional({
    description: 'Only rounds with a product priced at least this, integer VND',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  minPrice?: number;

  @ApiPropertyOptional({
    description: 'Only rounds with a product priced at most this, integer VND',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  maxPrice?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only this seller' })
  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}
