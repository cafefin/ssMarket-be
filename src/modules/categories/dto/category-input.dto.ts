import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCategoryDto {
  @ApiProperty({ example: 'Sách', minLength: 1, maxLength: 40 })
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  name!: string;

  @ApiProperty({ example: 'Books', minLength: 1, maxLength: 40 })
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  nameEn!: string;

  @ApiPropertyOptional({ description: 'Defaults to the end of the list' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(32000)
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 40 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  name?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 40 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(32000)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
